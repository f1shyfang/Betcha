// Bot market-maker driver. Recomputes the bot's fair value and quote ladder and
// re-posts it. MUST run in its own transactions (each placeOrder opens one) and
// NEVER be called from inside another order's transaction (same per-market
// advisory lock -> deadlock). Trigger after a placeOrder has committed, or on a cron.
const { query: defaultQuery } = require('../db');
const { loadBook } = require('./book');
const { markPrice } = require('./markPrice');
const { convergedFairValue, desiredQuotes } = require('./botQuoter');
const { botUserId, ensureBot } = require('./botAccount');
const { placeOrder } = require('./executor');

function dedupeQuotes(quotes) {
  const seen = new Set();
  const out = [];
  for (const qte of quotes) {
    const key = `${qte.side}:${qte.price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(qte);
  }
  return out;
}

async function requoteBot(marketId, deps) {
  const q = deps.query || defaultQuery;
  const bot = await ensureBot(marketId, q);

  const { rows: cfgRows } = await q(`SELECT * FROM market_exchange_config WHERE market_id=$1`, [marketId]);
  if (cfgRows.length === 0) return;
  const cfg = cfgRows[0];

  const book = await loadBook(marketId, q);
  const { rows: ltRows } = await q(`SELECT price FROM trades WHERE market_id=$1 ORDER BY created_at DESC LIMIT 1`, [marketId]);
  const lastTrade = ltRows[0] ? ltRows[0].price : null;
  const { rows: invRows } = await q(`SELECT shares FROM positions WHERE market_id=$1 AND user_id=$2`, [marketId, bot]);
  const inventory = invRows[0] ? Number(invRows[0].shares) : 0;
  const { rows: volRows } = await q(`SELECT COALESCE(SUM(quantity),0)::int AS vol FROM trades WHERE market_id=$1`, [marketId]);
  const volume = volRows[0].vol;

  const mark = markPrice(book, lastTrade);
  const effectiveMark = mark === null ? cfg.seed_price : mark;
  const fair = convergedFairValue({ seed: cfg.seed_price, mark: effectiveMark, volume, scale: 1000 });

  const quotes = dedupeQuotes(desiredQuotes({
    fairValue: fair,
    inventory,
    spread: cfg.bot_spread,
    levels: cfg.bot_levels,
    sizePerLevel: cfg.bot_size_per_level,
    maxInventory: cfg.bot_max_inventory,
    skewPerShare: 0.02,
  }));

  await q(`UPDATE orders SET status='cancelled' WHERE market_id=$1 AND user_id=$2 AND status IN ('open','partial')`, [marketId, bot]);

  for (const qte of quotes) {
    await placeOrder({ marketId, userId: bot, side: qte.side, price: qte.price, qty: qte.qty, type: 'limit', allowShort: true }, deps);
  }
}

module.exports = { requoteBot, dedupeQuotes };
