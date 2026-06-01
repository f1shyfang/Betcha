// Account/balance helpers for the exchange. Computed in single aggregate
// queries (cf. server/queries/balance.js). "Available cash" is settled cash
// (starting + ledger) minus the premium locked by resting BUY orders.
// "Sellable shares" is the long position minus shares already committed to
// open sell orders (so a user can't double-sell the same shares).
const { query: defaultQuery } = require('../db');

async function availableCash(userId, q = defaultQuery) {
  const { rows } = await q(
    `SELECT (
       COALESCE((SELECT starting_points FROM users WHERE id = $1), 2000)
       + COALESCE((SELECT SUM(delta) FROM ledger_entries WHERE user_id = $1), 0)
       - COALESCE((SELECT SUM(price * (quantity - filled_quantity))
                   FROM orders WHERE user_id = $1 AND side = 'buy' AND status IN ('open','partial')), 0)
     )::int AS cash`,
    [userId]
  );
  return rows[0].cash;
}

async function sellableShares(marketId, userId, q = defaultQuery) {
  const { rows } = await q(
    `SELECT (
       COALESCE((SELECT shares FROM positions WHERE market_id = $1 AND user_id = $2), 0)
       - COALESCE((SELECT SUM(quantity - filled_quantity)
                   FROM orders WHERE market_id = $1 AND user_id = $2 AND side = 'sell' AND status IN ('open','partial')), 0)
     )::int AS sellable`,
    [marketId, userId]
  );
  return rows[0].sellable;
}

module.exports = { availableCash, sellableShares };
