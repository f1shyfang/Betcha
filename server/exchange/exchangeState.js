// Aggregated read for the exchange detail page / poll. One parallel batch of
// queries (cf. server/queries/marketDetail.js): book depth ladder (price ->
// summed remaining qty), mark price, last trade, the viewer's position and
// open orders. Read-only.
const { query: defaultQuery } = require('../db');
const { loadBook } = require('./book');
const { markPrice } = require('./markPrice');
const { bankruptcyPrice, liquidationPrice } = require('./liquidation');
const { botUserId } = require('./botAccount');
const { convergedFairValue } = require('./botQuoter');

function ladder(orders, botId) {
  const byPrice = new Map();
  for (const o of orders) {
    const cur = byPrice.get(o.price) || { qty: 0, botQty: 0 };
    cur.qty += o.qty;
    if (botId && o.userId === botId) cur.botQty += o.qty;
    byPrice.set(o.price, cur);
  }
  return [...byPrice.entries()].map(([price, { qty, botQty }]) => ({ price, qty, botQty }));
}

async function getExchangeState(marketId, userId, q = defaultQuery) {
  const book = await loadBook(marketId, q);
  const botId = botUserId(marketId);

  // Best bot bid/ask from per-order arrays (before collapsing into ladder)
  const botBidPrices = book.bids.filter((o) => o.userId === botId).map((o) => o.price);
  const botAskPrices = book.asks.filter((o) => o.userId === botId).map((o) => o.price);
  const bestBid = botBidPrices.length ? Math.max(...botBidPrices) : null;
  const bestAsk = botAskPrices.length ? Math.min(...botAskPrices) : null;

  const [lastTradeRes, posRes, ordersRes, cfgRes, tapeRes, botPosRes, volRes, recentOrdersRes] = await Promise.all([
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
      `SELECT maintenance_margin, seed_price, bot_max_inventory FROM market_exchange_config WHERE market_id=$1`,
      [marketId]
    ),
    q(
      `SELECT price, quantity AS qty, created_at FROM trades WHERE market_id=$1 ORDER BY created_at DESC LIMIT 30`,
      [marketId]
    ),
    q(
      `SELECT shares FROM positions WHERE market_id=$1 AND user_id=$2`,
      [marketId, botId]
    ),
    q(
      `SELECT COALESCE(SUM(quantity),0)::int AS v FROM trades WHERE market_id=$1`,
      [marketId]
    ),
    q(
      `SELECT id, user_id, side, price, (quantity-filled_quantity) AS qty, status, created_at
       FROM orders WHERE market_id=$1 ORDER BY created_at DESC LIMIT 40`,
      [marketId]
    ),
  ]);

  const lastTrade = lastTradeRes.rows[0] ? lastTradeRes.rows[0].price : null;
  const mark = markPrice(book, lastTrade);
  const cfg = cfgRes.rows[0] || {};
  const maintenanceMargin = cfg.maintenance_margin ? Number(cfg.maintenance_margin) : 3;

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

  const trades = tapeRes.rows
    .map((r) => ({ price: r.price, qty: r.qty, at: r.created_at }))
    .reverse();

  // Bot object
  const inventory = botPosRes.rows[0] ? Number(botPosRes.rows[0].shares) : 0;
  const volume = Number(volRes.rows[0].v);
  const seedPrice = cfg.seed_price ? Number(cfg.seed_price) : 50;
  const maxInventory = cfg.bot_max_inventory ? Number(cfg.bot_max_inventory) : 0;
  const fairValue = Math.round(convergedFairValue({ seed: seedPrice, mark: mark ?? seedPrice, volume, scale: 1000 }));
  const spread = (bestBid != null && bestAsk != null) ? bestAsk - bestBid : null;
  const capUsedPct = maxInventory ? Math.round(100 * Math.abs(inventory) / maxInventory) : 0;
  const bot = { inventory, fairValue, bestBid, bestAsk, spread, maxInventory, capUsedPct };

  // Recent orders
  const recentOrders = recentOrdersRes.rows.map((r) => ({
    id: r.id,
    isBot: r.user_id === botId,
    side: r.side,
    price: Number(r.price),
    qty: Number(r.qty),
    status: r.status,
    at: r.created_at,
  }));

  return {
    book: { bids: ladder(book.bids, botId), asks: ladder(book.asks, botId) },
    mark,
    lastTrade,
    trades,
    myPosition,
    myOpenOrders: ordersRes.rows.map((r) => ({ id: r.id, side: r.side, price: r.price, qty: r.qty, status: r.status })),
    bot,
    recentOrders,
  };
}

module.exports = { getExchangeState };
