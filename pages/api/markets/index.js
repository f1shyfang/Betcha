const db = require('../../../server/db');
const { getUserFromRequest } = require('../../../server/supabaseAuth');
const { applyCors } = require('../../../server/cors');

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method === 'POST') {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });

    const { group_id, title, resolve_by } = req.body;
    if (!group_id || !title) return res.status(400).json({ error: 'group_id and title are required' });

    try {
      // Upsert user
      await db.query(`INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [user.id, user.email]);

      // Check membership
      const member = await db.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [group_id, user.id]);
      if (member.rowCount === 0) return res.status(403).json({ error: 'forbidden' });

      const marketRes = await db.query(
        'INSERT INTO markets (group_id, creator_id, title, resolve_by) VALUES ($1, $2, $3, $4) RETURNING *',
        [group_id, user.id, title, resolve_by || null]
      );

      return res.status(200).json(marketRes.rows[0]);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'internal server error' });
    }
  } else if (req.method === 'GET') {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });

    const { group_id } = req.query;

    try {
      let query = `
        SELECT m.*, 
               (SELECT count(*) FROM predictions WHERE market_id = m.id) as prediction_count
        FROM markets m
      `;
      const params = [];
      
      if (group_id) {
        query += ` WHERE m.group_id = $1`;
        params.push(group_id);
        // Verify user is in group
        const member = await db.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [group_id, user.id]);
        if (member.rowCount === 0) return res.status(403).json({ error: 'forbidden' });
      } else {
        // Find markets in user's groups
        query += `
          JOIN group_members gm ON m.group_id = gm.group_id
          WHERE gm.user_id = $1
        `;
        params.push(user.id);
      }
      
      query += ` ORDER BY m.created_at DESC`;
      const markets = await db.query(query, params);
      
      return res.status(200).json(markets.rows);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'internal server error' });
    }
  }

  res.status(405).json({ error: 'method not allowed' });
}
