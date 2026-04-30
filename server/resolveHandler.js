const { requireSupabaseAdmin } = require('./supabaseAdmin');

// Shared resolve market logic — used by both Express app and Vercel serverless function
const handleResolve = async (deps) => {
  const { marketId, outcome, method = 'creator', reason = '', idempKey, getIdempotentResponse, storeIdempotentResponse, userId } = deps;

  try {
    const prior = await getIdempotentResponse(idempKey);
    if (prior) return { status: 200, body: prior };

    const supabase = requireSupabaseAdmin();

    const { data: marketRows, error: marketErr } = await supabase
      .from('markets')
      .select('id,group_id,state')
      .eq('id', marketId)
      .limit(1);
    if (marketErr) throw marketErr;

    const market = marketRows?.[0];
    if (!market) return { status: 404, body: { error: 'market not found' } };
    if (market.state !== 'open') return { status: 409, body: { error: 'market not open' } };

    const { data: memberRows, error: memberErr } = await supabase
      .from('group_members')
      .select('role')
      .eq('group_id', market.group_id)
      .eq('user_id', userId)
      .limit(1);
    if (memberErr) throw memberErr;
    if (!memberRows || memberRows.length === 0) return { status: 403, body: { error: 'forbidden' } };

    const { error: rpcError } = await supabase.rpc('market_resolve_with_ledger', {
      p_market_id: marketId,
      p_resolver_id: userId || null,
      p_outcome: outcome,
      p_method: method,
      p_reason: reason,
    });

    if (rpcError) {
      if (rpcError.code === '42883') {
        return { status: 503, body: { error: 'migration_pending', hint: 'apply 003_market_resolve_rpc.sql' } };
      }
      throw rpcError;
    }

    const response = { market_id: marketId, outcome };
    await storeIdempotentResponse(idempKey, response);
    return { status: 200, body: response };
  } catch (e) {
    console.error('Unexpected error', e);
    return { status: 500, body: { error: 'internal' } };
  }
};

module.exports = { handleResolve };
