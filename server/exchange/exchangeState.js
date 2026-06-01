// Aggregated read for the exchange detail page / poll. One parallel batch of
// queries (cf. server/queries/marketDetail.js): book depth ladder (price ->
// summed remaining qty), mark price, last trade, the viewer's position and
// open orders. Read-only.
const { query: defaultQuery } = require('../db');
const { loadBook } = require('./book');
const { markPrice } = require('./markPrice');

function ladder(orders) {
  const byPrice = new Map();
  for (const o of orders) byPrice.set(o.price, (byPrice.get(o.price) || 0) + o.qty);
  return [...byPrice.entries()].map(([price, qty]) => ({ price, qty }));
}

async function getExchangeState(marketId, userId, q = defaultQuery) {
  const book = await loadBook(marketId, q);
  const [lastTradeRes, posRes, ordersRes] = await Promise.all([
    q(`SELECT price FROM trades WHERE market_id=$1 ORDER BY created_at DESC LIMIT 1`, [marketId]),
    q(`SELECT shares, avg_entry, realized_pnl FROM positions WHERE market_id=$1 AND user_id=$2`, [marketId, userId]),
    q(`SELECT id, side, price, (quantity-filled_quantity) AS qty, status FROM orders
       WHERE market_id=$1 AND user_id=$2 AND status IN ('open','partial') ORDER BY sequence ASC`, [marketId, userId]),
  ]);
  const lastTrade = lastTradeRes.rows[0] ? lastTradeRes.rows[0].price : null;
  const pos = posRes.rows[0]
    ? { shares: Number(posRes.rows[0].shares), avgEntry: Number(posRes.rows[0].avg_entry), realizedPnl: Number(posRes.rows[0].realized_pnl) }
    : { shares: 0, avgEntry: 0, realizedPnl: 0 };
  return {
    book: { bids: ladder(book.bids), asks: ladder(book.asks) },
    mark: markPrice(book, lastTrade),
    lastTrade,
    myPosition: pos,
    myOpenOrders: ordersRes.rows.map((r) => ({ id: r.id, side: r.side, price: r.price, qty: r.qty, status: r.status })),
  };
}

module.exports = { getExchangeState };
