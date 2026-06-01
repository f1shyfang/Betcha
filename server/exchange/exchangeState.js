// Aggregated read for the exchange detail page / poll. One parallel batch of
// queries (cf. server/queries/marketDetail.js): book depth ladder (price ->
// summed remaining qty), mark price, last trade, the viewer's position and
// open orders. Read-only.
const { query: defaultQuery } = require('../db');
const { loadBook } = require('./book');
const { markPrice } = require('./markPrice');
const { bankruptcyPrice, liquidationPrice } = require('./liquidation');

function ladder(orders) {
  const byPrice = new Map();
  for (const o of orders) byPrice.set(o.price, (byPrice.get(o.price) || 0) + o.qty);
  return [...byPrice.entries()].map(([price, qty]) => ({ price, qty }));
}

async function getExchangeState(marketId, userId, q = defaultQuery) {
  const book = await loadBook(marketId, q);
  const [lastTradeRes, posRes, ordersRes, cfgRes] = await Promise.all([
    q(`SELECT price FROM trades WHERE market_id=$1 ORDER BY created_at DESC LIMIT 1`, [marketId]),
    q(
      `SELECT shares, avg_entry, realized_pnl, margin_posted, leverage
       FROM positions WHERE market_id=$1 AND user_id=$2`,
      [marketId, userId]
    ),
    q(
      `SELECT id, side, price, (quantity-filled_quantity) AS qty, status FROM orders
       WHERE market_id=$1 AND user_id=$2 AND status IN ('open','partial') ORDER BY sequence ASC`,
      [marketId, userId]
    ),
    q(
      `SELECT maintenance_margin FROM market_exchange_config WHERE market_id=$1`,
      [marketId]
    ),
  ]);
  const lastTrade = lastTradeRes.rows[0] ? lastTradeRes.rows[0].price : null;
  const mark = markPrice(book, lastTrade);
  const maintenanceMargin = cfgRes.rows[0] ? Number(cfgRes.rows[0].maintenance_margin) : 3;

  let myPosition;
  if (posRes.rows[0]) {
    const r = posRes.rows[0];
    const shares = Number(r.shares);
    const avgEntry = Number(r.avg_entry);
    const realizedPnl = Number(r.realized_pnl);
    const marginPosted = Number(r.margin_posted);
    const leverage = Number(r.leverage);

    if (shares !== 0) {
      const side = shares > 0 ? 'buy' : 'sell';
      const unrealizedPnl = mark !== null
        ? Math.round((mark - avgEntry) * shares)
        : 0;
      const bp = bankruptcyPrice({ side, entry: avgEntry, leverage });
      const lp = liquidationPrice({ side, entry: avgEntry, leverage, maintenanceMargin });
      myPosition = {
        shares,
        avgEntry,
        realizedPnl,
        marginPosted,
        leverage,
        unrealizedPnl,
        bankruptcyPrice: bp,
        liquidationPrice: lp,
      };
    } else {
      myPosition = {
        shares: 0,
        avgEntry,
        realizedPnl,
        marginPosted: 0,
        leverage,
        unrealizedPnl: 0,
        bankruptcyPrice: null,
        liquidationPrice: null,
      };
    }
  } else {
    myPosition = {
      shares: 0,
      avgEntry: 0,
      realizedPnl: 0,
      marginPosted: 0,
      leverage: 1,
      unrealizedPnl: 0,
      bankruptcyPrice: null,
      liquidationPrice: null,
    };
  }

  return {
    book: { bids: ladder(book.bids), asks: ladder(book.asks) },
    mark,
    lastTrade,
    myPosition,
    myOpenOrders: ordersRes.rows.map((r) => ({ id: r.id, side: r.side, price: r.price, qty: r.qty, status: r.status })),
  };
}

module.exports = { getExchangeState };
