import { applyCors } from '../../server/cors';
import { query } from '../../server/db';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const { email, name, source } = req.body || {};
  if (!email || typeof email !== 'string') return res.status(400).json({ error: 'email required' });

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  if (!emailOk) return res.status(400).json({ error: 'invalid email' });

  try {
    const { rows } = await query(
      `INSERT INTO waitlist (email, name, source)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING
       RETURNING *`,
      [email.toLowerCase(), name || null, source || null]
    );
    return res.status(200).json({ success: true, entry: rows[0] || null });
  } catch (e) {
    console.error('Waitlist error', e);
    return res.status(500).json({ error: 'internal' });
  }
}
