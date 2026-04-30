const { applyCors } = require('../../../../server/cors');
const { requireSupabaseAdmin } = require('../../../../server/supabaseAdmin');

async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const marketId = req.query.id;

  try {
    const supabaseAdmin = requireSupabaseAdmin();

    const { data: marketRows, error: marketErr } = await supabaseAdmin
      .from('markets')
      .select('id,group_id,creator_id,title,type,state,resolve_by,resolution,created_at')
      .eq('id', marketId)
      .limit(1);
    if (marketErr) throw marketErr;

    const market = marketRows?.[0];
    if (!market) {
      return res.status(404).json({ error: 'market not found' });
    }

    const { data: predictionRows, error: predictionErr } = await supabaseAdmin
      .from('predictions')
      .select('choice')
      .eq('market_id', marketId);
    if (predictionErr) throw predictionErr;

    const predictionCount = (predictionRows || []).length;
    const yesCount = (predictionRows || []).filter((row) => row.choice === true).length;
    const noCount = (predictionRows || []).filter((row) => row.choice === false).length;

    return res.status(200).json({
      market: {
        ...market,
        prediction_count: predictionCount,
        yes_count: yesCount,
        no_count: noCount,
      },
    });
  } catch (e) {
    console.error('market detail error', e);
    return res.status(500).json({ error: 'internal' });
  }
}

module.exports = handler;
module.exports.default = handler;
