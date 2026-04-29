const { handleResolve } = require('../../../../server/resolveHandler');
const db = require('../../../../server/db');
const { getIdempotentResponse, storeIdempotentResponse } = require('../../../../server/idempotency');
const { getUserFromRequest } = require('../../../../server/supabaseAuth');
const { applyCors } = require('../../../../server/cors');
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

async function resolveViaSupabase({ marketId, outcome, userId }) {
  if (!supabaseAdmin) {
    return { status: 503, body: { error: 'Database unavailable and Supabase fallback not configured.' } };
  }

  const { data: marketRows, error: marketErr } = await supabaseAdmin
    .from('markets')
    .select('id,group_id,state')
    .eq('id', marketId)
    .limit(1);

  if (marketErr) {
    console.error('supabase resolve fetch market error', marketErr);
    return { status: 500, body: { error: 'internal' } };
  }

  const market = marketRows?.[0];
  if (!market) return { status: 404, body: { error: 'market not found' } };
  if (market.state !== 'open') return { status: 409, body: { error: 'market not open' } };

  const { data: memberRows, error: memberErr } = await supabaseAdmin
    .from('group_members')
    .select('role')
    .eq('group_id', market.group_id)
    .eq('user_id', userId)
    .limit(1);

  if (memberErr) {
    console.error('supabase resolve membership error', memberErr);
    return { status: 500, body: { error: 'internal' } };
  }
  if (!memberRows || memberRows.length === 0) {
    return { status: 403, body: { error: 'forbidden' } };
  }

  const resolution = {
    outcome,
    resolved_at: new Date().toISOString(),
  };
  const { error: updateErr } = await supabaseAdmin
    .from('markets')
    .update({ state: 'resolved', resolution })
    .eq('id', marketId);

  if (updateErr) {
    console.error('supabase resolve update market error', updateErr);
    return { status: 500, body: { error: 'internal' } };
  }

  return { status: 200, body: { market_id: marketId, resolution_id: null, outcome } };
}

async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  try {
    const marketId = req.query.id;
    const { outcome, method = 'creator', reason = '' } = req.body || {};
    const idempKey = req.headers['idempotency-key'];
    const user = await getUserFromRequest(req);

    if (!user) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const result = await handleResolve({
      marketId,
      outcome,
      method,
      reason,
      idempKey,
      db,
      getIdempotentResponse,
      storeIdempotentResponse,
      userId: user.id
    });
    if (result.status === 500) {
      const fallback = await resolveViaSupabase({
        marketId,
        outcome,
        userId: user.id,
      });
      return res.status(fallback.status).json(fallback.body);
    }
    return res.status(result.status).json(result.body);
  } catch (e) {
    console.error('resolve route error', e);
    return res.status(500).json({ error: 'internal' });
  }
}

module.exports = handler;
module.exports.default = handler;
