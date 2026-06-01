// Transactional trade executor (margin/equity model, Plan 4). One txn under a
// per-market advisory lock. Supports leverage + human shorting: positions lock
// margin = positionMargin(); fills realize P&L on reductions to
// ledger_entries('realized_pnl'); no premium booked. availableCash nets margin
// + open-order escrow. The bot (allowShort) skips margin/short/leverage checks.
const { loadBook } = require('./book');
const { matchOrder } = require('./matching');
const { applyFill } = require('./positions');
const { positionMargin } = require('./positionMargin');
const { liquidationPrice } = require('./liquidation');

async function loadPosition(q, marketId, userId) {
  const { rows } = await q(
    `SELECT shares, avg_entry, realized_pnl, leverage FROM positions WHERE market_id=$1 AND user_id=$2`,
    [marketId, userId]);
  if (rows.length === 0) return { shares: 0, avgEntry: 0, realizedPnl: 0, leverage: 1 };
  return { shares: Number(rows[0].shares), avgEntry: Number(rows[0].avg_entry), realizedPnl: Number(rows[0].realized_pnl), leverage: Number(rows[0].leverage) };
}

async function savePosition(q, marketId, userId, p, leverage) {
  const lev = p.shares === 0 ? 1 : (leverage || 1);
  const margin = positionMargin({ shares: p.shares, avgEntry: p.avgEntry, leverage: lev });
  await q(
    `INSERT INTO positions (market_id, user_id, shares, avg_entry, realized_pnl, margin_posted, leverage, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())
     ON CONFLICT (market_id, user_id) DO UPDATE SET shares=$3, avg_entry=$4, realized_pnl=$5, margin_posted=$6, leverage=$7, updated_at=now()`,
    [marketId, userId, p.shares, p.avgEntry, Math.round(p.realizedPnl), margin, lev]);
}

async function availableCashTx(q, userId) {
  const { rows } = await q(
    `SELECT (
       COALESCE((SELECT starting_points FROM users WHERE id=$1),2000)
       + COALESCE((SELECT SUM(delta) FROM ledger_entries WHERE user_id=$1),0)
       - COALESCE((SELECT SUM(margin_posted) FROM positions WHERE user_id=$1),0)
       - COALESCE((SELECT SUM(CASE WHEN side='buy'
                                   THEN CEIL((price*(quantity-filled_quantity))::numeric/leverage)
                                   ELSE CEIL(((100-price)*(quantity-filled_quantity))::numeric/leverage) END)
                   FROM orders WHERE user_id=$1 AND status IN ('open','partial')),0)
     )::int AS cash`, [userId]);
  return rows[0].cash;
}

async function placeOrder(input, deps) {
  const { marketId, userId, side, price, qty, type, allowShort = false, leverage = 1 } = input;
  if (type === 'market') return { status: 'error', error: 'market_orders_plan3' };

  const client = await deps.getClient();
  const q = (text, params) => client.query(text, params);
  try {
    await q('BEGIN');
    await q('SELECT pg_advisory_xact_lock(hashtext($1))', [marketId]);

    const { rows: mrows } = await q(
      `SELECT m.mechanism, m.state, c.max_leverage, c.maintenance_margin
       FROM markets m LEFT JOIN market_exchange_config c ON c.market_id = m.id
       WHERE m.id=$1`, [marketId]);
    if (mrows.length === 0 || mrows[0].mechanism !== 'exchange' || mrows[0].state !== 'open') {
      await q('ROLLBACK'); return { status: 'error', error: 'market_not_open' };
    }
    const maxLev = mrows[0].max_leverage || 1;
    const maint = mrows[0].maintenance_margin || 3;

    if (!allowShort) {
      if (!Number.isInteger(leverage) || leverage < 1 || leverage > maxLev) {
        await q('ROLLBACK'); return { status: 'error', error: 'invalid_leverage' };
      }
      const before = await loadPosition(q, marketId, userId);
      const after = applyFill({ shares: before.shares, avgEntry: before.avgEntry, realizedPnl: 0 }, side, price, qty);
      const marginBefore = positionMargin({ shares: before.shares, avgEntry: before.avgEntry, leverage: before.leverage });
      const marginAfter = positionMargin({ shares: after.shares, avgEntry: after.avgEntry, leverage });
      const deltaMargin = marginAfter - marginBefore;
      if (deltaMargin > 0) {
        const cash = await availableCashTx(q, userId);
        if (deltaMargin > cash) { await q('ROLLBACK'); return { status: 'error', error: 'insufficient_margin' }; }
      }
      if (after.shares !== 0 && Math.abs(after.shares) > Math.abs(before.shares)) {
        const posSide = after.shares > 0 ? 'buy' : 'sell';
        const liq = liquidationPrice({ side: posSide, entry: after.avgEntry, leverage, maintenanceMargin: maint });
        const bad = posSide === 'buy' ? (liq >= after.avgEntry) : (liq <= after.avgEntry);
        if (bad) { await q('ROLLBACK'); return { status: 'error', error: 'leverage_too_high' }; }
      }
    }

    const lev = allowShort ? Math.min(leverage || 1, 10) : leverage;
    const { rows: orows } = await q(
      `INSERT INTO orders (market_id, user_id, side, price, quantity, filled_quantity, leverage, status)
       VALUES ($1,$2,$3,$4,$5,0,$6,'open') RETURNING id`,
      [marketId, userId, side, price, qty, lev]);
    const incomingId = orows[0].id;

    const book = await loadBook(marketId, q);
    book.bids = book.bids.filter((o) => o.id !== incomingId);
    book.asks = book.asks.filter((o) => o.id !== incomingId);
    book.byId.delete(incomingId);

    const { fills, filledQty, residualQty } = matchOrder({ side, price, qty }, book);

    let takerPos = await loadPosition(q, marketId, userId);
    const takerSharesBefore = takerPos.shares;
    const takerLevBefore = takerPos.leverage;
    const takerRealizedBefore = takerPos.realizedPnl;
    const makerPos = new Map();
    const makerOrderLev = new Map();
    const makerSharesBefore = new Map();
    const makerLevBefore = new Map();
    const makerRealizedBefore = new Map();

    for (const fill of fills) {
      const maker = book.byId.get(fill.makerId);
      takerPos = applyFill(takerPos, side, fill.price, fill.qty);
      if (maker.userId === userId) {
        takerPos = applyFill(takerPos, maker.side, fill.price, fill.qty);
      } else {
        if (!makerPos.has(maker.userId)) {
          const mp = await loadPosition(q, marketId, maker.userId);
          makerPos.set(maker.userId, mp);
          makerOrderLev.set(maker.userId, maker.leverage || mp.leverage || 1);
          makerSharesBefore.set(maker.userId, mp.shares);
          makerLevBefore.set(maker.userId, mp.leverage);
          makerRealizedBefore.set(maker.userId, mp.realizedPnl);
        }
        makerPos.set(maker.userId, applyFill(makerPos.get(maker.userId), maker.side, fill.price, fill.qty));
      }

      await q(`UPDATE orders SET filled_quantity = filled_quantity + $2,
               status = CASE WHEN filled_quantity + $2 >= quantity THEN 'filled' ELSE 'partial' END WHERE id=$1`,
        [maker.id, fill.qty]);

      await q(`INSERT INTO trades (market_id, price, quantity, taker_order_id, maker_order_id, taker_user, maker_user)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [marketId, fill.price, fill.qty, incomingId, maker.id, userId, maker.userId]);
    }

    const takerRealizedDelta = Math.round(takerPos.realizedPnl - takerRealizedBefore);
    if (takerRealizedDelta !== 0) {
      await q(`INSERT INTO ledger_entries (user_id, market_id, delta, reason) VALUES ($1,$2,$3,'realized_pnl')`,
        [userId, marketId, takerRealizedDelta]);
    }
    for (const [mUser, mPos] of makerPos) {
      const d = Math.round(mPos.realizedPnl - makerRealizedBefore.get(mUser));
      if (d !== 0) await q(`INSERT INTO ledger_entries (user_id, market_id, delta, reason) VALUES ($1,$2,$3,'realized_pnl')`, [mUser, marketId, d]);
    }

    // Effective position leverage: keep prior leverage when reducing; use the
    // order's leverage only when opening/increasing the position.
    const takerEffLev = Math.abs(takerPos.shares) > Math.abs(takerSharesBefore) ? lev : takerLevBefore;
    await savePosition(q, marketId, userId, takerPos, takerEffLev);
    for (const [mUser, mPos] of makerPos) {
      const effLev = Math.abs(mPos.shares) > Math.abs(makerSharesBefore.get(mUser)) ? makerOrderLev.get(mUser) : makerLevBefore.get(mUser);
      await savePosition(q, marketId, mUser, mPos, effLev);
    }

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
