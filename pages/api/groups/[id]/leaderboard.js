import { getUserFromRequest } from '../../../../lib/auth';
import { applyCors } from '../../../../server/cors';
import { query } from '../../../../server/db';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  const groupId = req.query.id;
  if (!groupId) return res.status(400).json({ error: 'group id is required' });

  try {
    const { rows: memberRows } = await query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1',
      [groupId, user.id]
    );
    if (memberRows.length === 0) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const { rows: marketRows } = await query(
      'SELECT id FROM markets WHERE group_id = $1',
      [groupId]
    );
    const marketIds = marketRows.map((row) => row.id).filter(Boolean);

    let ledgerRows = [];
    if (marketIds.length > 0) {
      const result = await query(
        'SELECT user_id, market_id, delta, reason, created_at FROM ledger_entries WHERE market_id = ANY($1)',
        [marketIds]
      );
      ledgerRows = result.rows;
    }

    const scores = new Map();
    const history = new Map();
    for (const row of ledgerRows) {
      scores.set(row.user_id, (scores.get(row.user_id) || 0) + (row.delta || 0));
      if (!history.has(row.user_id)) history.set(row.user_id, []);
      history.get(row.user_id).push({
        delta: row.delta || 0,
        reason: row.reason,
        created_at: row.created_at,
      });
    }

    const { rows: groupMemberRows } = await query(
      'SELECT user_id FROM group_members WHERE group_id = $1',
      [groupId]
    );

    const scoredUserIds = [...new Set(groupMemberRows.map((row) => row.user_id).filter(Boolean))];
    if (scoredUserIds.length === 0) return res.status(200).json([]);

    const { rows: userRows } = await query(
      'SELECT id, email, display_name, starting_points FROM users WHERE id = ANY($1)',
      [scoredUserIds]
    );
    const userMap = new Map(userRows.map((u) => [u.id, u]));

    const leaderboard = [...scores.entries()]
      .map(([userId, score]) => {
        const u = userMap.get(userId);
        const display_name = u?.display_name ?? (u?.email ? u.email.split('@')[0] : userId);
        const balance = (u?.starting_points ?? 2000) + score;
        const recent = (history.get(userId) || [])
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .slice(0, 5);
        const trendWindow = recent.slice(0, 3).reduce((sum, row) => sum + row.delta, 0);
        const trend = trendWindow > 0 ? 'up' : (trendWindow < 0 ? 'down' : 'flat');
        return { user_id: userId, display_name, score: balance, raw_delta: score, last_deltas: recent, trend };
      })
      .sort((left, right) => right.score - left.score);

    return res.status(200).json(leaderboard);
  } catch (err) {
    console.error('leaderboard error', err);
    return res.status(500).json({ error: 'internal server error' });
  }
}
