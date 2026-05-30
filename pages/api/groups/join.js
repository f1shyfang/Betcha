import { getUserFromRequest } from '../../../lib/auth';
import { applyCors } from '../../../server/cors';
import { query } from '../../../server/db';

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
    await query(
      `INSERT INTO users (id, email) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
      [user.id, user.email]
    );

    const { rows: inviteRows } = await query(
      'SELECT id, group_id FROM invites WHERE token = $1 AND expires_at > now() LIMIT 1',
      [token]
    );
    const invite = inviteRows[0];
    if (!invite) {
      return res.status(400).json({ error: 'invalid or expired token' });
    }

    await query(
      `INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)
       ON CONFLICT (group_id, user_id) DO NOTHING`,
      [invite.group_id, user.id]
    );

    return res.status(200).json({ group_id: invite.group_id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'internal server error' });
  }
}
