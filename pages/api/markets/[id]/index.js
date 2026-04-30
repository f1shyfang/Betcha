const { applyCors } = require('../../../../server/cors');
const { requireSupabaseAdmin } = require('../../../../server/supabaseAdmin');
const { getUserFromRequest } = require('../../../../server/supabaseAuth');

async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

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

    const { data: memberRows, error: memberErr } = await supabaseAdmin
      .from('group_members')
      .select('role')
      .eq('group_id', market.group_id)
      .eq('user_id', user.id)
      .limit(1);
    if (memberErr) throw memberErr;
    if (!memberRows || memberRows.length === 0) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const { data: predictionRows, error: predictionErr } = await supabaseAdmin
      .from('predictions')
      .select('choice')
      .eq('market_id', marketId);
    if (predictionErr) throw predictionErr;

    const { data: mySettlementRows, error: settlementErr } = await supabaseAdmin
      .from('ledger_entries')
      .select('delta,reason,created_at')
      .eq('market_id', marketId)
      .eq('user_id', user.id);
    if (settlementErr) throw settlementErr;

    const { data: myPredictionRow, error: myPredictionErr } = await supabaseAdmin
      .from('predictions')
      .select('stake_points,choice,created_at')
      .eq('market_id', marketId)
      .eq('user_id', user.id)
      .limit(1)
      .single();
    if (myPredictionErr && myPredictionErr.code !== 'PGRST116') throw myPredictionErr;

    const { data: userRow, error: userErr } = await supabaseAdmin
      .from('users')
      .select('starting_points')
      .eq('id', user.id)
      .limit(1)
      .single();
    if (userErr) throw userErr;

    const { data: allLedgerRows, error: allLedgerErr } = await supabaseAdmin
      .from('ledger_entries')
      .select('delta')
      .eq('user_id', user.id);
    if (allLedgerErr) throw allLedgerErr;

    const predictionCount = (predictionRows || []).length;
    const yesCount = (predictionRows || []).filter((row) => row.choice === true).length;
    const noCount = (predictionRows || []).filter((row) => row.choice === false).length;

    const settlementBreakdown = {};
    let settlementDelta = 0;
    for (const row of mySettlementRows || []) {
      settlementBreakdown[row.reason] = (settlementBreakdown[row.reason] || 0) + (row.delta || 0);
      settlementDelta += row.delta || 0;
    }
    const userBalance = (userRow?.starting_points ?? 2000) + (allLedgerRows || []).reduce((sum, row) => sum + (row.delta || 0), 0);

    return res.status(200).json({
      market: {
        ...market,
        prediction_count: predictionCount,
        yes_count: yesCount,
        no_count: noCount,
        my_settlement: {
          total_delta: settlementDelta,
          breakdown: settlementBreakdown,
        },
        my_prediction: myPredictionRow || null,
        my_balance: userBalance,
      },
    });
  } catch (e) {
    console.error('market detail error', e);
    return res.status(500).json({ error: 'internal' });
  }
}

module.exports = handler;
module.exports.default = handler;
