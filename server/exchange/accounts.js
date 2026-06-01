// Account/balance helpers for the exchange. Computed in a single aggregate
// query (cf. server/queries/balance.js). "Available cash" is settled cash
// (starting + ledger) minus locked position margin minus open-order escrow.
//
// Margin model:
//   available = starting_points
//             + Σ ledger_entries.delta
//             − Σ positions.margin_posted        (across all markets)
//             − Σ open-order escrow               (buy: ceil(price*(qty-filled)/lev)
//                                                  sell: ceil((100-price)*(qty-filled)/lev))
const { query: defaultQuery } = require('../db');

async function availableCash(userId, q = defaultQuery) {
  const { rows } = await q(
    `SELECT (
       COALESCE((SELECT starting_points FROM users WHERE id = $1), 2000)
       + COALESCE((SELECT SUM(delta) FROM ledger_entries WHERE user_id = $1), 0)
       - COALESCE((SELECT SUM(margin_posted) FROM positions WHERE user_id = $1), 0)
       - COALESCE((
           SELECT SUM(
             CASE side
               WHEN 'buy'  THEN CEIL((price::numeric * (quantity - filled_quantity)) / leverage)
               WHEN 'sell' THEN CEIL(((100 - price)::numeric * (quantity - filled_quantity)) / leverage)
             END
           )
           FROM orders
           WHERE user_id = $1
             AND status IN ('open', 'partial')
         ), 0)
     )::int AS cash`,
    [userId]
  );
  return rows[0].cash;
}

module.exports = { availableCash };
