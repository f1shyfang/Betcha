const db = require('../../../../server/db');
const { getUserFromRequest } = require('../../../../server/supabaseAuth');
const { applyCors } = require('../../../../server/cors');
const crypto = require('crypto');

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
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

    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    const invite = await db.query(
      'INSERT INTO invites (group_id, token, inviter_id, expires_at) VALUES ($1, $2, $3, $4) RETURNING token, expires_at',
      [groupId, token, user.id, expiresAt.toISOString()]
    );

    return res.status(200).json(invite.rows[0]);
  } catch (err) {
    console.error('invite error', err);
    return res.status(500).json({ error: 'internal server error' });
  }
}
