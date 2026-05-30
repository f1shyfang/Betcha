import crypto from 'crypto';
import { getUserFromRequest } from '../../../../lib/auth';
import { applyCors } from '../../../../server/cors';
import { query } from '../../../../server/db';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'GET' && req.method !== 'POST') {
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

    if (req.method === 'GET') {
      const { rows: inviteRows } = await query(
        `SELECT token, inviter_id, expires_at, used_by_user_id
         FROM invites WHERE group_id = $1 AND expires_at > now()`,
        [groupId]
      );
      return res.status(200).json(inviteRows);
    }

    // POST
    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const { rows } = await query(
      `INSERT INTO invites (group_id, token, inviter_id, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING token, expires_at`,
      [groupId, token, user.id, expiresAt.toISOString()]
    );

    return res.status(200).json(rows[0]);
  } catch (err) {
    console.error('invite error', err);
    return res.status(500).json({ error: 'internal server error' });
  }
}
