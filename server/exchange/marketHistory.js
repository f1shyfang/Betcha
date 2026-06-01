// Time-series for the Pro price chart. prices = trade prints; botBand = the bot's
// best bid/ask reconstructed per re-quote batch from the orders table (including
// cancelled orders — the bot cancels+reposts its whole ladder each re-quote, and
// each batch shares a created_at, so grouping by created_at yields one band sample
// per re-quote). botMarkers = trades where the bot was a counterparty, with side.
const { query: defaultQuery } = require('../db');
const { botUserId } = require('./botAccount');

async function getMarketHistory(marketId, q = defaultQuery) {
  const bot = botUserId(marketId);
  const [pricesRes, botOrdersRes, markersRes] = await Promise.all([
    q(`SELECT price, created_at AS at FROM trades WHERE market_id=$1 ORDER BY created_at ASC LIMIT 500`, [marketId]),
    q(`SELECT side, price, created_at AS at FROM orders WHERE market_id=$1 AND user_id=$2 ORDER BY created_at ASC`, [marketId, bot]),
    q(`SELECT t.price, t.created_at AS at, o.side AS side
       FROM trades t
       JOIN orders o ON o.id = CASE WHEN t.taker_user=$2 THEN t.taker_order_id
                                    WHEN t.maker_user=$2 THEN t.maker_order_id END
       WHERE t.market_id=$1 AND ($2 IN (t.taker_user, t.maker_user))
       ORDER BY t.created_at ASC LIMIT 500`, [marketId, bot]),
  ]);

  // Group bot orders into re-quote batches by 1-second bucket. Each requoteBot()
  // call places orders sequentially in separate transactions (each with their own
  // created_at), but all complete within milliseconds, so a 1-second floor reliably
  // clusters an entire re-quote ladder into a single band sample.
  const byBatch = new Map();
  for (const r of botOrdersRes.rows) {
    const key = Math.floor(new Date(r.at).getTime() / 1000);
    if (!byBatch.has(key)) byBatch.set(key, { at: r.at, bids: [], asks: [] });
    (r.side === 'buy' ? byBatch.get(key).bids : byBatch.get(key).asks).push(r.price);
  }
  const botBand = [...byBatch.values()]
    .map((b) => ({ at: b.at, bid: b.bids.length ? Math.max(...b.bids) : null, ask: b.asks.length ? Math.min(...b.asks) : null }))
    .filter((b) => b.bid !== null && b.ask !== null);

  return {
    prices: pricesRes.rows.map((r) => ({ at: r.at, price: r.price })),
    botBand,
    botMarkers: markersRes.rows.map((r) => ({ at: r.at, price: r.price, side: r.side })),
  };
}

module.exports = { getMarketHistory };
