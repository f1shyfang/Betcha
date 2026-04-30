const { getUserFromRequest } = require('../../../server/supabaseAuth');
const { applyCors } = require('../../../server/cors');
const { requireSupabaseAdmin } = require('../../../server/supabaseAdmin');

async function assertGroupMembership(groupId, userId) {
  const supabaseAdmin = requireSupabaseAdmin();
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
  const supabaseAdmin = requireSupabaseAdmin();
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
    .single();
  if (error) throw error;

  return { market: data };
}

async function attachPredictionCounts(markets) {
  const supabaseAdmin = requireSupabaseAdmin();
  const marketIds = (markets || []).map((market) => market.id).filter(Boolean);
  if (marketIds.length === 0) return markets;

  const { data: predictionRows, error } = await supabaseAdmin
    .from('predictions')
    .select('market_id')
    .in('market_id', marketIds);
  if (error) throw error;

  const counts = new Map();
  for (const row of predictionRows || []) {
    counts.set(row.market_id, (counts.get(row.market_id) || 0) + 1);
  }

  return markets.map((market) => ({
    ...market,
    prediction_count: counts.get(market.id) || 0,
  }));
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method === 'POST') {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });

    const { group_id, title, resolve_by } = req.body;
    if (!group_id || !title) return res.status(400).json({ error: 'group_id and title are required' });

    try {
      const result = await createMarketViaSupabase(user, { group_id, title, resolve_by });
      return res.status(200).json(result.market);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'internal server error' });
    }
  } else if (req.method === 'GET') {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });

    const { group_id } = req.query;

    try {
      if (group_id) {
        const allowed = await assertGroupMembership(group_id, user.id);
        if (!allowed) return res.status(403).json({ error: 'forbidden' });

        const supabaseAdmin = requireSupabaseAdmin();
        const { data: marketRows, error: marketErr } = await supabaseAdmin
          .from('markets')
          .select('*')
          .eq('group_id', group_id)
          .order('created_at', { ascending: false });
        if (marketErr) throw marketErr;

        const markets = await attachPredictionCounts(marketRows || []);
        return res.status(200).json(markets);
      }

      const supabaseAdmin = requireSupabaseAdmin();
      const { data: memberRows, error: memberErr } = await supabaseAdmin
        .from('group_members')
        .select('group_id')
        .eq('user_id', user.id);
      if (memberErr) throw memberErr;

      const groupIds = [...new Set((memberRows || []).map((row) => row.group_id).filter(Boolean))];
      if (groupIds.length === 0) {
        return res.status(200).json([]);
      }

      const { data: marketRows, error: marketErr } = await supabaseAdmin
        .from('markets')
        .select('*')
        .in('group_id', groupIds)
        .order('created_at', { ascending: false });
      if (marketErr) throw marketErr;

      const markets = await attachPredictionCounts(marketRows || []);
      return res.status(200).json(markets);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'internal server error' });
    }
  }

  res.status(405).json({ error: 'method not allowed' });
}
