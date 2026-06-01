const { query } = require('../db');
const { getUserBalance } = require('./balance');

// Market detail for a single viewer. Returns { status, body }.
// The market lookup and membership check are sequential (membership needs the
// market's group_id, and both gate access). Everything after that is
// independent, so it runs concurrently. Counts and balance are aggregated in
// SQL rather than fetched row-by-row and summed in JS.
async function getMarketDetail(marketId, userId, q = query) {
  const { rows: marketRows } = await q(
    `SELECT id, group_id, creator_id, title, type, state, resolve_by, resolution, created_at
     FROM markets WHERE id = $1 LIMIT 1`,
    [marketId]
  );
  const market = marketRows[0];
  if (!market) return { status: 404, body: { error: 'market not found' } };

  const { rows: memberRows } = await q(
    'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1',
    [market.group_id, userId]
  );
  if (memberRows.length === 0) return { status: 403, body: { error: 'forbidden' } };

  const [countsResult, settlementResult, myPredictionResult, userBalance] = await Promise.all([
    q(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE choice = true)::int AS yes,
              COUNT(*) FILTER (WHERE choice = false)::int AS no
       FROM predictions WHERE market_id = $1`,
      [marketId]
    ),
    q(
      'SELECT delta, reason, created_at FROM ledger_entries WHERE market_id = $1 AND user_id = $2',
      [marketId, userId]
    ),
    q(
      'SELECT stake_points, choice, created_at FROM predictions WHERE market_id = $1 AND user_id = $2 LIMIT 1',
      [marketId, userId]
    ),
    getUserBalance(userId, q),
  ]);

  const counts = countsResult.rows[0];
  const settlementBreakdown = {};
  let settlementDelta = 0;
  for (const row of settlementResult.rows) {
    settlementBreakdown[row.reason] = (settlementBreakdown[row.reason] || 0) + (row.delta || 0);
    settlementDelta += row.delta || 0;
  }

  return {
    status: 200,
    body: {
      market: {
        ...market,
        prediction_count: counts.total,
        yes_count: counts.yes,
        no_count: counts.no,
        my_settlement: {
          total_delta: settlementDelta,
          breakdown: settlementBreakdown,
        },
        my_prediction: myPredictionResult.rows[0] || null,
        my_balance: userBalance,
      },
    },
  };
}

module.exports = { getMarketDetail };
