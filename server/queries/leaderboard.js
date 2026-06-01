const { query } = require('../db');

// Group leaderboard. Returns { status, body }.
// Scores are aggregated in SQL (SUM per user) and the per-user "recent activity"
// is bounded to the latest 5 rows via a window function, instead of pulling
// every ledger row for the group and summing in JS. Only users with ledger
// activity appear (matches prior behavior).
async function getLeaderboard(groupId, userId, q = query) {
  const { rows: memberRows } = await q(
    'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1',
    [groupId, userId]
  );
  if (memberRows.length === 0) return { status: 403, body: { error: 'forbidden' } };

  // One pass over the group's ledger: total delta per user (full SUM) plus the
  // 5 most recent entries per user. raw_delta is the same on every row for a
  // given user (window SUM over the whole partition).
  const { rows: ledgerRows } = await q(
    `SELECT user_id, delta, reason, created_at, raw_delta FROM (
       SELECT user_id, delta, reason, created_at,
              SUM(delta) OVER (PARTITION BY user_id)::int AS raw_delta,
              ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
       FROM ledger_entries
       WHERE market_id IN (SELECT id FROM markets WHERE group_id = $1)
     ) t
     WHERE rn <= 5
     ORDER BY user_id, created_at DESC`,
    [groupId]
  );

  if (ledgerRows.length === 0) return { status: 200, body: [] };

  const perUser = new Map();
  for (const row of ledgerRows) {
    if (!perUser.has(row.user_id)) {
      perUser.set(row.user_id, { raw_delta: row.raw_delta || 0, recent: [] });
    }
    perUser.get(row.user_id).recent.push({
      delta: row.delta || 0,
      reason: row.reason,
      created_at: row.created_at,
    });
  }

  const userIds = [...perUser.keys()];
  const { rows: userRows } = await q(
    'SELECT id, email, display_name, starting_points FROM users WHERE id = ANY($1)',
    [userIds]
  );
  const userMap = new Map(userRows.map((u) => [u.id, u]));

  const leaderboard = userIds
    .map((id) => {
      const { raw_delta, recent } = perUser.get(id);
      const u = userMap.get(id);
      const display_name = u?.display_name ?? (u?.email ? u.email.split('@')[0] : id);
      const score = (u?.starting_points ?? 2000) + raw_delta;
      const trendWindow = recent.slice(0, 3).reduce((sum, r) => sum + r.delta, 0);
      const trend = trendWindow > 0 ? 'up' : trendWindow < 0 ? 'down' : 'flat';
      return { user_id: id, display_name, score, raw_delta, last_deltas: recent, trend };
    })
    .sort((left, right) => right.score - left.score);

  return { status: 200, body: leaderboard };
}

module.exports = { getLeaderboard };
