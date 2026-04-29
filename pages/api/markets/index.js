const db = require('../../../server/db');
const { getUserFromRequest } = require('../../../server/supabaseAuth');
const { applyCors } = require('../../../server/cors');
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;
const DB_UNAVAILABLE_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH']);
const isDbUnavailableError = (err) => Boolean(err && DB_UNAVAILABLE_CODES.has(err.code));

async function assertGroupMembership(groupId, userId) {
  if (!supabaseAdmin) throw new Error('supabase_admin_not_configured');
  const { data, error } = await supabaseAdmin
    .from('group_members')
    .select('role')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .limit(1);
  if (error) throw error;
  return Boolean(data && data.length > 0);
}

async function createMarketViaSupabase(user, payload) {
  if (!supabaseAdmin) throw new Error('supabase_admin_not_configured');
  const { group_id, title, resolve_by } = payload;

  const isMember = await assertGroupMembership(group_id, user.id);
  if (!isMember) return { forbidden: true };

  const { data, error } = await supabaseAdmin
    .from('markets')
    .insert({
      group_id,
      creator_id: user.id,
      title,
      resolve_by: resolve_by || null,
    })
    .select('*')
    .limit(1);
  if (error) throw error;

  const created = data?.[0];
  if (!created) throw new Error('market_create_failed');
  return { market: created };
}

async function listMarketsViaSupabase(userId, groupId) {
  if (!supabaseAdmin) throw new Error('supabase_admin_not_configured');

  if (groupId) {
    const isMember = await assertGroupMembership(groupId, userId);
    if (!isMember) return { forbidden: true };

    const { data, error } = await supabaseAdmin
      .from('markets')
      .select('*')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return { markets: (data || []).map((m) => ({ ...m, prediction_count: 0 })) };
  }

  const { data: memberRows, error: memberErr } = await supabaseAdmin
    .from('group_members')
    .select('group_id')
    .eq('user_id', userId);
  if (memberErr) throw memberErr;

  const groupIds = [...new Set((memberRows || []).map((row) => row.group_id).filter(Boolean))];
  if (groupIds.length === 0) return { markets: [] };

  const { data: marketRows, error: marketErr } = await supabaseAdmin
    .from('markets')
    .select('*')
    .in('group_id', groupIds)
    .order('created_at', { ascending: false });
  if (marketErr) throw marketErr;

  return { markets: (marketRows || []).map((m) => ({ ...m, prediction_count: 0 })) };
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  const dbUnavailableMessage = 'Database unavailable. Set DATABASE_URL or start local Postgres.';

  if (req.method === 'POST') {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });

    const { group_id, title, resolve_by } = req.body;
    if (!group_id || !title) return res.status(400).json({ error: 'group_id and title are required' });

    try {
      // Upsert user
      await db.query(`INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [user.id, user.email]);

      // Check membership
      const member = await db.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [group_id, user.id]);
      if (member.rowCount === 0) return res.status(403).json({ error: 'forbidden' });

      const marketRes = await db.query(
        'INSERT INTO markets (group_id, creator_id, title, resolve_by) VALUES ($1, $2, $3, $4) RETURNING *',
        [group_id, user.id, title, resolve_by || null]
      );

      return res.status(200).json(marketRes.rows[0]);
    } catch (err) {
      console.error(err);
      if (isDbUnavailableError(err)) {
        try {
          const result = await createMarketViaSupabase(user, { group_id, title, resolve_by });
          if (result?.forbidden) return res.status(403).json({ error: 'forbidden' });
          return res.status(200).json(result.market);
        } catch (fallbackErr) {
          console.error('supabase fallback market create error', fallbackErr);
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

    const { group_id } = req.query;

    try {
      let query = `
        SELECT m.*, 
               (SELECT count(*) FROM predictions WHERE market_id = m.id) as prediction_count
        FROM markets m
      `;
      const params = [];
      
      if (group_id) {
        query += ` WHERE m.group_id = $1`;
        params.push(group_id);
        // Verify user is in group
        const member = await db.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [group_id, user.id]);
        if (member.rowCount === 0) return res.status(403).json({ error: 'forbidden' });
      } else {
        // Find markets in user's groups
        query += `
          JOIN group_members gm ON m.group_id = gm.group_id
          WHERE gm.user_id = $1
        `;
        params.push(user.id);
      }
      
      query += ` ORDER BY m.created_at DESC`;
      const markets = await db.query(query, params);
      
      return res.status(200).json(markets.rows);
    } catch (err) {
      console.error(err);
      if (isDbUnavailableError(err)) {
        try {
          const result = await listMarketsViaSupabase(user.id, group_id);
          if (result?.forbidden) return res.status(403).json({ error: 'forbidden' });
          return res.status(200).json(result.markets);
        } catch (fallbackErr) {
          console.error('supabase fallback markets list error', fallbackErr);
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
