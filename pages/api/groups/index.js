const db = require('../../../server/db');
const { getUserFromRequest } = require('../../../server/supabaseAuth');
const { applyCors } = require('../../../server/cors');
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

async function createGroupViaSupabase(user, name, isPrivate) {
  if (!supabaseAdmin) {
    throw new Error('supabase_admin_not_configured');
  }

  const { error: userErr } = await supabaseAdmin
    .from('users')
    .upsert({ id: user.id, email: user.email }, { onConflict: 'id' });
  if (userErr) throw userErr;

  const { data: groupRows, error: groupErr } = await supabaseAdmin
    .from('groups')
    .insert({ name, owner_id: user.id, is_private: isPrivate })
    .select('id,name,is_private,created_at')
    .limit(1);
  if (groupErr) throw groupErr;

  const group = groupRows?.[0];
  if (!group) {
    throw new Error('group_create_failed');
  }

  const { error: memberErr } = await supabaseAdmin
    .from('group_members')
    .insert({ group_id: group.id, user_id: user.id, role: 'admin' });
  if (memberErr) {
    // best-effort cleanup to avoid orphan groups when membership insert fails
    await supabaseAdmin.from('groups').delete().eq('id', group.id);
    throw memberErr;
  }

  return group;
}

async function listGroupsViaSupabase(userId) {
  if (!supabaseAdmin) {
    throw new Error('supabase_admin_not_configured');
  }

  const { data, error } = await supabaseAdmin
    .from('group_members')
    .select('role,groups!inner(id,name,is_private,created_at)')
    .eq('user_id', userId);

  if (error) throw error;

  return (data || []).map((row) => ({
    id: row.groups.id,
    name: row.groups.name,
    is_private: row.groups.is_private,
    created_at: row.groups.created_at,
    role: row.role,
  }));
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  const dbUnavailableMessage = 'Database unavailable. Set DATABASE_URL or start local Postgres.';

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
      if (err?.code === 'ECONNREFUSED') {
        try {
          const group = await createGroupViaSupabase(user, name, is_private);
          return res.status(200).json(group);
        } catch (fallbackErr) {
          console.error('supabase fallback group create error', fallbackErr);
          return res.status(503).json({
            error: dbUnavailableMessage,
            fallback_error: 'Supabase fallback failed. Check SUPABASE_SERVICE_ROLE_KEY and table permissions.',
          });
        }
      }
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
      if (err?.code === 'ECONNREFUSED') {
        try {
          const groups = await listGroupsViaSupabase(user.id);
          return res.status(200).json(groups);
        } catch (fallbackErr) {
          console.error('supabase fallback groups list error', fallbackErr);
          return res.status(503).json({
            error: dbUnavailableMessage,
            fallback_error: 'Supabase fallback failed. Check SUPABASE_SERVICE_ROLE_KEY and table permissions.',
          });
        }
      }
      return res.status(500).json({ error: 'internal server error' });
    }
  }

  res.status(405).json({ error: 'method not allowed' });
}
