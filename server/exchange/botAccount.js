// The per-market bot market-maker account. It is a normal users row with a
// deterministic id (bot:<marketId>) seeded with a large balance; the executor's
// allowShort path lets it quote the ask side without inventory. App-backed.
const { query: defaultQuery } = require('../db');

const BOT_STARTING_POINTS = 1000000000;

function botUserId(marketId) {
  return `bot:${marketId}`;
}

async function ensureBot(marketId, q = defaultQuery) {
  const id = botUserId(marketId);
  await q(
    `INSERT INTO users (id, email, display_name, starting_points)
     VALUES ($1, $2, 'Market Maker', $3) ON CONFLICT (id) DO NOTHING`,
    [id, `${id}@bot.internal`, BOT_STARTING_POINTS]
  );
  return id;
}

module.exports = { botUserId, ensureBot, BOT_STARTING_POINTS };
