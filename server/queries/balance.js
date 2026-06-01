const { query } = require('../db');

// A user's balance is their starting_points plus the sum of all their ledger
// deltas. Computed in a single aggregate round-trip rather than fetching every
// ledger row and summing in JS. Defaults starting_points to 2000 if the user
// row doesn't exist yet (matches prior handler behavior).
async function getUserBalance(userId, q = query) {
  const { rows } = await q(
    `SELECT (
       COALESCE((SELECT starting_points FROM users WHERE id = $1), 2000)
       + COALESCE((SELECT SUM(delta) FROM ledger_entries WHERE user_id = $1), 0)
     )::int AS balance`,
    [userId]
  );
  return rows[0].balance;
}

module.exports = { getUserBalance };
