const db = require('../../../server/db');
const { getUserFromRequest } = require('../../../server/supabaseAuth');
const { applyCors } = require('../../../server/cors');

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method === 'POST') {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });

    const { name, is_private = true } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    try {
      // Upsert user to ensure they exist in public.users
      await db.query(`INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [user.id, user.email]);

      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        
        const groupRes = await client.query(
          'INSERT INTO groups (name, owner_id, is_private) VALUES ($1, $2, $3) RETURNING id, name, is_private, created_at',
          [name, user.id, is_private]
        );
        const group = groupRes.rows[0];

        await client.query(
          'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
          [group.id, user.id, 'admin']
        );

        await client.query('COMMIT');
        return res.status(200).json(group);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('group create error', err);
        return res.status(500).json({ error: 'internal server error' });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'internal server error' });
    }
  } else if (req.method === 'GET') {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });

    try {
      const groups = await db.query(`
        SELECT g.id, g.name, g.is_private, g.created_at, gm.role
        FROM groups g
        JOIN group_members gm ON g.id = gm.group_id
        WHERE gm.user_id = $1
      `, [user.id]);
      
      return res.status(200).json(groups.rows);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'internal server error' });
    }
  }

  res.status(405).json({ error: 'method not allowed' });
}
