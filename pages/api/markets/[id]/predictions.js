const { getUserFromRequest } = require('../../../../server/supabaseAuth');
const { applyCors } = require('../../../../server/cors');
const { getIdempotentResponse, storeIdempotentResponse } = require('../../../../server/idempotency');
const { requireSupabaseAdmin } = require('../../../../server/supabaseAdmin');

async function loadMarketWithMembership(marketId, userId) {
  const supabaseAdmin = requireSupabaseAdmin();

  const { data: marketRows, error: marketErr } = await supabaseAdmin
    .from('markets')
    .select('id,group_id,state')
    .eq('id', marketId)
    .limit(1);
  if (marketErr) throw marketErr;
  const market = marketRows?.[0];
  if (!market) return { notFound: true };

  const { data: memberRows, error: memberErr } = await supabaseAdmin
    .from('group_members')
    .select('role')
    .eq('group_id', market.group_id)
    .eq('user_id', userId)
    .limit(1);
  if (memberErr) throw memberErr;
  if (!memberRows || memberRows.length === 0) return { forbidden: true };

  return { market };
}

async function listPredictionsViaSupabase(marketId, userId) {
  const marketStatus = await loadMarketWithMembership(marketId, userId);
  if (marketStatus.notFound) return { status: 404, body: { error: 'market not found' } };
  if (marketStatus.forbidden) return { status: 403, body: { error: 'forbidden' } };

  const supabaseAdmin = requireSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('predictions')
    .select('user_id,choice,stake_points,created_at')
    .eq('market_id', marketId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const rows = data || [];
  const userIds = [...new Set(rows.map((p) => p.user_id))];
  let userMap = new Map();
  if (userIds.length > 0) {
    const { data: userRows, error: userErr } = await supabaseAdmin
      .from('users')
      .select('id,email,display_name')
      .in('id', userIds);
    if (userErr) throw userErr;
    userMap = new Map((userRows || []).map((u) => [u.id, u]));
  }

  const enriched = rows.map((p) => {
    const u = userMap.get(p.user_id);
    return {
      ...p,
      display_name: u?.display_name ?? (u?.email ? u.email.split('@')[0] : p.user_id),
    };
  });

  return { status: 200, body: enriched };
}

async function getUserBalance(supabaseAdmin, userId) {
  const { data: userRow, error: userErr } = await supabaseAdmin
    .from('users')
    .select('starting_points')
    .eq('id', userId)
    .limit(1)
    .single();
  if (userErr) throw userErr;

  const { data: ledgerRows, error: ledgerErr } = await supabaseAdmin
    .from('ledger_entries')
    .select('delta')
    .eq('user_id', userId);
  if (ledgerErr) throw ledgerErr;

  const ledgerTotal = (ledgerRows || []).reduce((sum, row) => sum + (row.delta || 0), 0);
  return (userRow?.starting_points ?? 2000) + ledgerTotal;
}

async function createPredictionViaSupabase(marketId, userId, userEmail, choice, stakePoints) {
  const marketStatus = await loadMarketWithMembership(marketId, userId);
  if (marketStatus.notFound) return { status: 404, body: { error: 'market not found' } };
  if (marketStatus.forbidden) return { status: 403, body: { error: 'forbidden' } };
  if (marketStatus.market.state !== 'open') return { status: 400, body: { error: 'market is not open' } };

  const supabaseAdmin = requireSupabaseAdmin();
  const { error: userErr } = await supabaseAdmin
    .from('users')
    .upsert({ id: userId, email: userEmail }, { onConflict: 'id' });
  if (userErr) throw userErr;

  const balance = await getUserBalance(supabaseAdmin, userId);
  if (stakePoints > balance) {
    return { status: 400, body: { error: 'insufficient points', balance } };
  }

  const { data, error } = await supabaseAdmin
    .from('predictions')
    .insert({
      market_id: marketId,
      user_id: userId,
      choice,
      stake_points: stakePoints,
      created_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') {
      return { status: 409, body: { error: 'prediction already placed for this market' } };
    }
    throw error;
  }

  const { error: ledgerErr } = await supabaseAdmin
    .from('ledger_entries')
    .insert({
      user_id: userId,
      market_id: marketId,
      delta: -stakePoints,
      reason: 'wager_stake',
    });
  if (ledgerErr) throw ledgerErr;

  return { status: 200, body: data || null };
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  const marketId = req.query.id;
  if (req.method === 'GET') {
    try {
      const fallback = await listPredictionsViaSupabase(marketId, user.id);
      return res.status(fallback.status).json(fallback.body);
    } catch (err) {
      console.error('prediction list error', err);
      return res.status(500).json({ error: 'internal server error' });
    }
  }

  if (req.method === 'POST') {
    const { choice, stake_points } = req.body;
    if (typeof choice !== 'boolean') return res.status(400).json({ error: 'choice boolean is required' });
    const stakePoints = Number(stake_points);
    if (!Number.isInteger(stakePoints) || stakePoints <= 0) {
      return res.status(400).json({ error: 'stake_points positive integer is required' });
    }

    const idempKey = req.headers['idempotency-key'];

    try {
      if (idempKey) {
        const prior = await getIdempotentResponse(idempKey);
        if (prior) return res.status(200).json(prior);
      }

      const fallback = await createPredictionViaSupabase(marketId, user.id, user.email, choice, stakePoints);
      if (idempKey) await storeIdempotentResponse(idempKey, fallback.body);

      return res.status(fallback.status).json(fallback.body);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'internal server error' });
    }
  }

  return res.status(405).json({ error: 'method not allowed' });
}
