// Loads the live order book for a market from Postgres into the in-memory shape
// the pure matching engine expects: { bids, asks, byId }. Only open/partial
// orders are live; qty is the REMAINING quantity (quantity - filled_quantity).
// byId lets the executor resolve a fill's maker side/user without re-querying.
const { query: defaultQuery } = require('../db');

async function loadBook(marketId, q = defaultQuery) {
  const { rows } = await q(
    `SELECT id, user_id, side, price, (quantity - filled_quantity) AS qty, sequence
     FROM orders
     WHERE market_id = $1 AND status IN ('open','partial')
     ORDER BY sequence ASC`,
    [marketId]
  );
  const bids = [];
  const asks = [];
  const byId = new Map();
  for (const r of rows) {
    const order = { id: r.id, userId: r.user_id, side: r.side, price: r.price, qty: r.qty, sequence: Number(r.sequence) };
    byId.set(order.id, order);
    (order.side === 'buy' ? bids : asks).push(order);
  }
  return { bids, asks, byId };
}

module.exports = { loadBook };
