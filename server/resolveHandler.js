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

    const { data: resolutionRows, error: resolutionErr } = await supabase
      .from('resolutions')
      .insert({
        market_id: marketId,
        resolver_id: userId || null,
        outcome,
        method,
        reason,
      })
      .select('id,created_at')
      .limit(1);

    if (resolutionErr) {
      if (resolutionErr.code === '23505') {
        const { data: existingRows, error: existingErr } = await supabase
          .from('resolutions')
          .select('id,outcome,created_at')
          .eq('market_id', marketId)
          .limit(1);
        if (existingErr) throw existingErr;
        const existing = existingRows?.[0];
        if (existing) {
          const response = { market_id: marketId, resolution_id: existing.id, outcome: existing.outcome };
          await storeIdempotentResponse(idempKey, response);
          return { status: 200, body: response };
        }
      }
      throw resolutionErr;
    }

    const resolution = resolutionRows?.[0];
    if (!resolution) throw new Error('resolution_insert_failed');

    const { error: marketUpdateErr } = await supabase
      .from('markets')
      .update({ state: 'resolved', resolution: { outcome, resolved_at: new Date().toISOString() } })
      .eq('id', marketId);
    if (marketUpdateErr) throw marketUpdateErr;

    const { data: predictionRows, error: predictionErr } = await supabase
      .from('predictions')
      .select('user_id,choice')
      .eq('market_id', marketId);
    if (predictionErr) throw predictionErr;

    const ledgerEntries = (predictionRows || []).map((prediction) => ({
      user_id: prediction.user_id,
      market_id: marketId,
      delta: prediction.choice === outcome ? 1 : -1,
      reason: prediction.choice === outcome ? 'win' : 'loss',
    }));

    if (ledgerEntries.length > 0) {
      const { error: ledgerErr } = await supabase.from('ledger_entries').insert(ledgerEntries);
      if (ledgerErr) throw ledgerErr;
    }

    const response = { market_id: marketId, resolution_id: resolution.id, outcome };
    await storeIdempotentResponse(idempKey, response);
    return { status: 200, body: response };
  } catch (e) {
    console.error('Unexpected error', e);
    return { status: 500, body: { error: 'internal' } };
  }
};

module.exports = { handleResolve };
