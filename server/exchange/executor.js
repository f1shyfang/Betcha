// Transactional trade executor. Runs the whole place-order flow in ONE
// transaction under a per-market Postgres advisory lock so concurrent orders
// for the same market cannot race the book. Plan 2 is long-only: buys open/add
// longs, sells close/reduce them; opening a short is rejected. Cash flows are
// recorded in ledger_entries (buy_fill debits, sell_fill credits); positions
// track shares/avg_entry/realized_pnl.
const { loadBook } = require('./book');
const { matchOrder } = require('./matching');
const { applyFill, emptyPosition } = require('./positions');

async function loadPosition(q, marketId, userId) {
  const { rows } = await q(
    `SELECT shares, avg_entry, realized_pnl FROM positions WHERE market_id=$1 AND user_id=$2`,
    [marketId, userId]
  );
  if (rows.length === 0) return emptyPosition();
  return { shares: Number(rows[0].shares), avgEntry: Number(rows[0].avg_entry), realizedPnl: Number(rows[0].realized_pnl) };
}

async function savePosition(q, marketId, userId, p) {
  await q(
    `INSERT INTO positions (market_id, user_id, shares, avg_entry, realized_pnl, updated_at)
     VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (market_id, user_id)
     DO UPDATE SET shares=$3, avg_entry=$4, realized_pnl=$5, updated_at=now()`,
    [marketId, userId, p.shares, p.avgEntry, Math.round(p.realizedPnl)]
  );
}

async function availableCashTx(q, userId) {
  const { rows } = await q(
    `SELECT (
       COALESCE((SELECT starting_points FROM users WHERE id=$1),2000)
       + COALESCE((SELECT SUM(delta) FROM ledger_entries WHERE user_id=$1),0)
       - COALESCE((SELECT SUM(price*(quantity-filled_quantity)) FROM orders
                   WHERE user_id=$1 AND side='buy' AND status IN ('open','partial')),0)
     )::int AS cash`, [userId]);
  return rows[0].cash;
}

async function sellableSharesTx(q, marketId, userId) {
  const { rows } = await q(
    `SELECT (
       COALESCE((SELECT shares FROM positions WHERE market_id=$1 AND user_id=$2),0)
       - COALESCE((SELECT SUM(quantity-filled_quantity) FROM orders
                   WHERE market_id=$1 AND user_id=$2 AND side='sell' AND status IN ('open','partial')),0)
     )::int AS sellable`, [marketId, userId]);
  return rows[0].sellable;
}

async function placeOrder(input, deps) {
  const { marketId, userId, side, price, qty, type, allowShort = false } = input;
  if (type === 'market') return { status: 'error', error: 'market_orders_plan3' };

  const client = await deps.getClient();
  const q = (text, params) => client.query(text, params);
  try {
    await q('BEGIN');
    await q('SELECT pg_advisory_xact_lock(hashtext($1))', [marketId]);

    const { rows: mrows } = await q(`SELECT mechanism, state FROM markets WHERE id=$1`, [marketId]);
    if (mrows.length === 0 || mrows[0].mechanism !== 'exchange' || mrows[0].state !== 'open') {
      await q('ROLLBACK');
      return { status: 'error', error: 'market_not_open' };
    }

    if (!allowShort) {
      if (side === 'sell') {
        const sellable = await sellableSharesTx(q, marketId, userId);
        if (qty > sellable) { await q('ROLLBACK'); return { status: 'error', error: 'short_not_allowed' }; }
      } else {
        const cash = await availableCashTx(q, userId);
        if (price * qty > cash) { await q('ROLLBACK'); return { status: 'error', error: 'insufficient_cash' }; }
      }
    }

    const { rows: orows } = await q(
      `INSERT INTO orders (market_id, user_id, side, price, quantity, filled_quantity, leverage, status)
       VALUES ($1,$2,$3,$4,$5,0,1,'open') RETURNING id`,
      [marketId, userId, side, price, qty]
    );
    const incomingId = orows[0].id;

    const book = await loadBook(marketId, q);
    book.bids = book.bids.filter((o) => o.id !== incomingId);
    book.asks = book.asks.filter((o) => o.id !== incomingId);
    book.byId.delete(incomingId);

    const { fills, filledQty, residualQty } = matchOrder({ side, price, qty }, book);

    let takerPos = await loadPosition(q, marketId, userId);
    const makerPos = new Map();

    for (const fill of fills) {
      const maker = book.byId.get(fill.makerId);
      takerPos = applyFill(takerPos, side, fill.price, fill.qty);
      if (maker.userId === userId) {
        // Self-trade: same DB position. Apply the maker side to the SAME in-memory
        // object so we don't load/save two divergent copies (the second save would
        // clobber the first). Net effect on a self-cross is a wash.
        takerPos = applyFill(takerPos, maker.side, fill.price, fill.qty);
      } else {
        if (!makerPos.has(maker.userId)) makerPos.set(maker.userId, await loadPosition(q, marketId, maker.userId));
        makerPos.set(maker.userId, applyFill(makerPos.get(maker.userId), maker.side, fill.price, fill.qty));
      }

      await q(
        `UPDATE orders SET filled_quantity = filled_quantity + $2,
           status = CASE WHEN filled_quantity + $2 >= quantity THEN 'filled' ELSE 'partial' END
         WHERE id = $1`,
        [maker.id, fill.qty]
      );

      const takerDelta = side === 'buy' ? -(fill.price * fill.qty) : (fill.price * fill.qty);
      const takerReason = side === 'buy' ? 'buy_fill' : 'sell_fill';
      await q(`INSERT INTO ledger_entries (user_id, market_id, delta, reason) VALUES ($1,$2,$3,$4)`,
        [userId, marketId, Math.round(takerDelta), takerReason]);
      const makerDelta = maker.side === 'buy' ? -(fill.price * fill.qty) : (fill.price * fill.qty);
      const makerReason = maker.side === 'buy' ? 'buy_fill' : 'sell_fill';
      await q(`INSERT INTO ledger_entries (user_id, market_id, delta, reason) VALUES ($1,$2,$3,$4)`,
        [maker.userId, marketId, Math.round(makerDelta), makerReason]);

      await q(
        `INSERT INTO trades (market_id, price, quantity, taker_order_id, maker_order_id, taker_user, maker_user)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [marketId, fill.price, fill.qty, incomingId, maker.id, userId, maker.userId]
      );
    }

    await savePosition(q, marketId, userId, takerPos);
    for (const [mUser, mPos] of makerPos) await savePosition(q, marketId, mUser, mPos);

    const incomingStatus = filledQty >= qty ? 'filled' : (filledQty > 0 ? 'partial' : 'open');
    await q(`UPDATE orders SET filled_quantity=$2, status=$3 WHERE id=$1`, [incomingId, filledQty, incomingStatus]);

    await q('COMMIT');
    return { status: 'ok', orderId: incomingId, fills, filledQty, residualQty };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { placeOrder };
