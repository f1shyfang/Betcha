const db = require('../../../../server/db');
const { getUserFromRequest } = require('../../../../server/supabaseAuth');
const { applyCors } = require('../../../../server/cors');

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
    // Verify membership
    const member = await db.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, user.id]);
    if (member.rowCount === 0) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const leaderboard = await db.query(`
      SELECT le.user_id, SUM(le.delta) as score
      FROM ledger_entries le
      JOIN markets m ON le.market_id = m.id
      WHERE m.group_id = $1
      GROUP BY le.user_id
      ORDER BY score DESC
    `, [groupId]);

    return res.status(200).json(leaderboard.rows);
  } catch (err) {
    console.error('leaderboard error', err);
    return res.status(500).json({ error: 'internal server error' });
  }
}
