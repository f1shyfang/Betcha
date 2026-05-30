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

  const { display_name } = req.body;

  try {
    await query(
      `INSERT INTO users (id, email, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE
         SET email = EXCLUDED.email,
             display_name = EXCLUDED.display_name`,
      [user.id, user.email, display_name || null]
    );
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('profile upsert error', err);
    return res.status(500).json({ error: 'internal server error' });
  }
}
