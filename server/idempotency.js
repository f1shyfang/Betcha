const { requireSupabaseAdmin } = require('./supabaseAdmin');

async function getIdempotentResponse(key) {
  if (!key) return null;
  const supabase = requireSupabaseAdmin();
  const { data, error } = await supabase
    .from('idempotency_keys')
    .select('response')
    .eq('key', key)
    .limit(1);

  if (error) throw error;
  return data?.[0]?.response || null;
}

async function storeIdempotentResponse(key, response) {
  if (!key) return;
  const supabase = requireSupabaseAdmin();
  const { error } = await supabase
    .from('idempotency_keys')
    .upsert({ key, response }, { onConflict: 'key' });

  if (error) throw error;
}

module.exports = { getIdempotentResponse, storeIdempotentResponse };
