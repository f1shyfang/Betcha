const db = require('../../../server/db');
const { getUserFromRequest } = require('../../../server/supabaseAuth');
const { applyCors } = require('../../../server/cors');

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token is required' });

  try {
    // Upsert user
    await db.query(`INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [user.id, user.email]);

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      
      const invite = await client.query('SELECT * FROM invites WHERE token = $1 AND expires_at > now() AND used_by_user_id IS NULL FOR UPDATE', [token]);
      if (invite.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'invalid or expired token' });
      }

      const groupId = invite.rows[0].group_id;

      await client.query(
        'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [groupId, user.id]
      );

      await client.query(
        'UPDATE invites SET used_by_user_id = $1 WHERE id = $2',
        [user.id, invite.rows[0].id]
      );

      await client.query('COMMIT');
      return res.status(200).json({ group_id: groupId });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('join error', err);
      return res.status(500).json({ error: 'internal server error' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'internal server error' });
  }
}
