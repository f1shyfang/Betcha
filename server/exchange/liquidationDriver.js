// Controlled liquidation engine (Plan 4, Task 5).
//
// Algorithm:
//   1. Load market config (maintenance_margin), book, last trade, mark price.
//      If mark is null (empty book, no trades) return { liquidated: [] } — we
//      cannot value positions without a reference price.
//   2. Load all open positions for the market, excluding the bot account whose
//      id is 'bot:<marketId>'. The bot is app-backed and never liquidated.
//   3. For each position check mustLiquidate(). If breached:
//      a. Compute bankruptcyPrice and cap the forced-close limit price inside it.
//         Long (shares>0): we SELL |shares|, cap = max(1, floor(bp))   — won't
//           sell below bankruptcy (protects against giving away value).
//         Short (shares<0): we BUY  |shares|, cap = min(99, ceil(bp))  — won't
//           buy above bankruptcy.
//      b. Submit the forced close via placeOrder(..., allowShort:true).  The bot's
//         quotes near the mark fill it at/inside the cap price, closing the position
//         and booking realized P&L into ledger_entries.
//      c. Re-read the position.  If a residual remains (book couldn't fill within
//         the cap), cover it via the insurance pool:
//
//         RESIDUAL-COVER FORMULA
//         ──────────────────────
//         For a residual long (r > 0) at avg_entry e with leverage L:
//           margin_residual   = ceil(e * r / L)       (points currently locked)
//           recover_at_bp     = floor(bp * r)          (proceeds if closed at bp)
//           pnl_at_bp         = (bp - e) * r           (≤ 0 — a loss)
//           net_at_bp         = margin_residual + pnl_at_bp
//
//         If net_at_bp ≥ 0 the user can absorb the loss out of their own margin.
//         If net_at_bp < 0 the insurance pool must cover the deficit |net_at_bp|.
//         Either way: book a ledger_entry(delta = pnl_at_bp, reason='liquidation')
//         so the realized loss is recorded, zero the position and its margin, then
//         debit the insurance pool by max(0, -net_at_bp).
//
//         Symmetric for a residual short (r < 0) at avg_entry e:
//           bp_short          = e + (100 - e) / L
//           margin_residual   = ceil((100 - e) * |r| / L)
//           pnl_at_bp         = (e - bp_short) * |r|   (≤ 0)
//           net_at_bp         = margin_residual + pnl_at_bp
//           insurance_debit   = max(0, -net_at_bp)
//
//         This guarantees the user's balance (starting + ledger − margin) never
//         goes below zero: margin_residual is exactly the max loss budgeted for
//         the position; pnl_at_bp ≥ -margin_residual by construction (bankruptcy
//         price is where equity = 0), so insurance_debit = 0 most of the time and
//         only positive if integer rounding causes a tiny overshoot.
//      d. Add user_id to the liquidated list.
//   4. Return { liquidated: [...userIds] }.

const { loadBook } = require('./book');
const { markPrice } = require('./markPrice');
const { bankruptcyPrice, mustLiquidate } = require('./liquidation');
const { placeOrder } = require('./executor');
const { positionMargin } = require('./positionMargin');
const { botUserId } = require('./botAccount');

async function runLiquidations(marketId, deps) {
  const q = deps.query;
  const liquidated = [];

  // 1. Load config
  const { rows: cfgRows } = await q(
    `SELECT maintenance_margin FROM market_exchange_config WHERE market_id=$1`,
    [marketId]
  );
  if (cfgRows.length === 0) return { liquidated };
  const maintenanceMargin = Number(cfgRows[0].maintenance_margin);

  // Load book and last trade, compute mark
  const book = await loadBook(marketId, q);
  const { rows: ltRows } = await q(
    `SELECT price FROM trades WHERE market_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [marketId]
  );
  const lastTrade = ltRows[0] ? Number(ltRows[0].price) : undefined;
  const mark = markPrice(book, lastTrade);

  if (mark === null) return { liquidated };

  // 2. Load all open positions, excluding the bot
  const botId = botUserId(marketId);
  const { rows: positions } = await q(
    `SELECT user_id, shares, avg_entry, leverage, margin_posted
     FROM positions
     WHERE market_id=$1 AND shares <> 0 AND user_id <> $2`,
    [marketId, botId]
  );

  // 3. Check each position
  for (const pos of positions) {
    const shares = Number(pos.shares);
    const avgEntry = Number(pos.avg_entry);
    const leverage = Number(pos.leverage);
    const marginPosted = Number(pos.margin_posted);
    const side = shares > 0 ? 'buy' : 'sell';
    const absShares = Math.abs(shares);

    if (!mustLiquidate({ side, entry: avgEntry }, mark, { leverage, maintenanceMargin })) {
      continue;
    }

    // 3a. Compute capped limit price
    const bp = bankruptcyPrice({ side, entry: avgEntry, leverage });
    let closeSide, limitPrice;
    if (side === 'buy') {
      // We are closing a long: sell the shares, won't sell below bp
      closeSide = 'sell';
      limitPrice = Math.max(1, Math.floor(bp));
    } else {
      // We are closing a short: buy the shares, won't buy above bp
      closeSide = 'buy';
      limitPrice = Math.min(99, Math.ceil(bp));
    }

    // 3b. Submit forced close (allowShort bypasses margin/short checks)
    const orderResult = await placeOrder(
      {
        marketId,
        userId: pos.user_id,
        side: closeSide,
        price: limitPrice,
        qty: absShares,
        type: 'limit',
        allowShort: true,
      },
      deps
    );

    // 3c. Re-read position to check for residual
    const { rows: afterRows } = await q(
      `SELECT shares, avg_entry, leverage, margin_posted FROM positions WHERE market_id=$1 AND user_id=$2`,
      [marketId, pos.user_id]
    );
    const afterShares = afterRows.length === 0 ? 0 : Number(afterRows[0].shares);

    if (afterShares !== 0) {
      // Residual remains — book couldn't fill within the cap. Cover via insurance pool.
      // Cancel any still-resting portion of the forced-close order so it cannot
      // re-open the position at a later crossing price or freeze the user's escrow.
      if (orderResult && orderResult.orderId) {
        await q(
          `UPDATE orders SET status='cancelled' WHERE id=$1 AND status IN ('open','partial')`,
          [orderResult.orderId]
        );
      }
      const residualShares = afterShares;
      const residualAbs = Math.abs(residualShares);
      const residualEntry = afterRows.length > 0 ? Number(afterRows[0].avg_entry) : avgEntry;
      const residualLev = afterRows.length > 0 ? Number(afterRows[0].leverage) : leverage;
      const residualMargin = afterRows.length > 0 ? Number(afterRows[0].margin_posted) : marginPosted;
      const residualSide = residualShares > 0 ? 'buy' : 'sell';

      // P&L if we close at bankruptcy price — always a loss (≤ 0 by construction)
      const bpResidual = bankruptcyPrice({ side: residualSide, entry: residualEntry, leverage: residualLev });
      // For a long: pnl = (bp - entry) * shares   (<= 0)
      // For a short: pnl = (entry - bp) * |shares| = -(bp - entry) * |shares|
      //   unified: pnl = dir * (bpResidual - residualEntry) * residualAbs
      //   where dir = +1 for long, -1 for short
      const dir = residualSide === 'buy' ? 1 : -1;
      const pnlAtBp = Math.round(dir * (bpResidual - residualEntry) * residualAbs);
      // net = what the user has left after crediting pnl and releasing margin
      // net_at_bp = residualMargin + pnlAtBp
      // if net_at_bp < 0, insurance must cover the gap
      const netAtBp = residualMargin + pnlAtBp;
      const insuranceDebit = Math.max(0, -netAtBp);

      // Book the realized loss into ledger_entries (the margin release is implicit:
      // zeroing the position removes it from the margin sum in availableCash).
      if (pnlAtBp !== 0) {
        await q(
          `INSERT INTO ledger_entries (user_id, market_id, delta, reason) VALUES ($1,$2,$3,'liquidation')`,
          [pos.user_id, marketId, pnlAtBp]
        );
      }

      // Zero the residual position
      await q(
        `UPDATE positions SET shares=0, margin_posted=0, avg_entry=0, updated_at=now()
         WHERE market_id=$1 AND user_id=$2`,
        [marketId, pos.user_id]
      );

      // Debit insurance pool if needed
      if (insuranceDebit > 0) {
        await q(
          `UPDATE insurance_pool SET balance = balance - $2, updated_at=now() WHERE market_id=$1`,
          [marketId, insuranceDebit]
        );
      }
    }

    liquidated.push(pos.user_id);
  }

  return { liquidated };
}

module.exports = { runLiquidations };
