const { getUserFromRequest } = require('../../../server/supabaseAuth');
const { applyCors } = require('../../../server/cors');
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;
const DB_UNAVAILABLE_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH']);
const isDbUnavailableError = (err) => Boolean(err && DB_UNAVAILABLE_CODES.has(err.code));

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

  if (req.method === 'POST') {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });

    const { name, is_private = true } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    try {
      const group = await createGroupViaSupabase(user, name, is_private);
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
      const groups = await listGroupsViaSupabase(user.id);
      return res.status(200).json(groups);
    } catch (err) {
      console.error('groups list error', err);
      return res.status(500).json({ error: 'internal server error' });
    }
  }

  return res.status(405).json({ error: 'method not allowed' });
}
