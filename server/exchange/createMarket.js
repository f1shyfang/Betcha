// Creates an exchange-type market: a markets row with mechanism='exchange' plus
// its market_exchange_config row. Returns { marketId }. Caller handles auth and
// group membership; this is the data-layer helper.
const { query: defaultQuery } = require('../db');
const { ensureInsurance } = require('./insurance');

async function createExchangeMarket({ groupId, creatorId, title, seedPrice = 50 }, q = defaultQuery) {
  const { rows } = await q(
    `INSERT INTO markets (group_id, creator_id, title, type, state, mechanism)
     VALUES ($1, $2, $3, 'binary', 'open', 'exchange') RETURNING id`,
    [groupId, creatorId, title]
  );
  const marketId = rows[0].id;
  await q(
    `INSERT INTO market_exchange_config (market_id, seed_price) VALUES ($1, $2)`,
    [marketId, seedPrice]
  );
  await ensureInsurance(marketId, q);
  return { marketId };
}

module.exports = { createExchangeMarket };
