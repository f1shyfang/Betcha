// Insurance pool helpers. Each exchange market starts with a seeded pool that
// absorbs rounding losses during liquidation. The pool is never negative in
// normal operation; large losses in exceptional scenarios could deplete it.
const { query: defaultQuery } = require('../db');

const INITIAL_INSURANCE = 10000;

/**
 * Ensure an insurance_pool row exists for the given market. If the row already
 * exists (idempotent — ON CONFLICT DO NOTHING), return the current balance
 * without overwriting it. Returns the current balance as a JS number.
 *
 * @param {string} marketId
 * @param {function} q   - query fn (default: pool query)
 * @param {number}  seed - initial balance if the row is new (default: 10000)
 */
async function ensureInsurance(marketId, q = defaultQuery, seed = INITIAL_INSURANCE) {
  await q(
    `INSERT INTO insurance_pool (market_id, balance)
     VALUES ($1, $2)
     ON CONFLICT (market_id) DO NOTHING`,
    [marketId, seed]
  );
  const { rows } = await q(
    `SELECT balance FROM insurance_pool WHERE market_id=$1`,
    [marketId]
  );
  return Number(rows[0].balance);
}

module.exports = { ensureInsurance, INITIAL_INSURANCE };
