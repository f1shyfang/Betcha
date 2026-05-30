import { getUserFromRequest } from '../../../lib/auth';
import { applyCors } from '../../../server/cors';
import { query } from '../../../server/db';

async function createGroup(user, name, isPrivate) {
  await query(
    `INSERT INTO users (id, email) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
    [user.id, user.email]
  );

  const { rows: groupRows } = await query(
    `INSERT INTO groups (name, owner_id, is_private)
     VALUES ($1, $2, $3)
     RETURNING id, name, is_private, created_at`,
    [name, user.id, isPrivate]
  );
  const group = groupRows[0];
  if (!group) {
    throw new Error('group_create_failed');
  }

  try {
    await query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'admin')`,
      [group.id, user.id]
    );
  } catch (memberErr) {
    await query('DELETE FROM groups WHERE id = $1', [group.id]);
    throw memberErr;
  }

  return group;
}

async function listGroups(userId) {
  const { rows } = await query(
    `SELECT g.id, g.name, g.is_private, g.created_at, gm.role
     FROM group_members gm
     JOIN groups g ON g.id = gm.group_id
     WHERE gm.user_id = $1`,
    [userId]
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    is_private: row.is_private,
    created_at: row.created_at,
    role: row.role,
  }));
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method === 'POST') {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });

    const { name, is_private = true } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    try {
      const group = await createGroup(user, name, is_private);
      return res.status(200).json(group);
    } catch (err) {
      console.error('group create error', err);
      return res.status(500).json({ error: 'internal server error' });
    }
  }

  if (req.method === 'GET') {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });

    try {
      const groups = await listGroups(user.id);
      return res.status(200).json(groups);
    } catch (err) {
      console.error('groups list error', err);
      return res.status(500).json({ error: 'internal server error' });
    }
  }

  return res.status(405).json({ error: 'method not allowed' });
}
