const { getUserFromRequest } = require('../../../../server/supabaseAuth');
const { applyCors } = require('../../../../server/cors');
const { requireSupabaseAdmin } = require('../../../../server/supabaseAdmin');

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  const groupId = req.query.id;
  if (!groupId) return res.status(400).json({ error: 'group id is required' });

  try {
    const supabaseAdmin = requireSupabaseAdmin();

    const { data: memberRows, error: memberErr } = await supabaseAdmin
      .from('group_members')
      .select('role')
      .eq('group_id', groupId)
      .eq('user_id', user.id)
      .limit(1);
    if (memberErr) throw memberErr;
    if (!memberRows || memberRows.length === 0) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const { data: marketRows, error: marketErr } = await supabaseAdmin
      .from('markets')
      .select('id')
      .eq('group_id', groupId);
    if (marketErr) throw marketErr;

    const marketIds = (marketRows || []).map((row) => row.id).filter(Boolean);
    if (marketIds.length === 0) {
      return res.status(200).json([]);
    }

    const { data: ledgerRows, error: ledgerErr } = await supabaseAdmin
      .from('ledger_entries')
      .select('user_id,market_id,delta')
      .in('market_id', marketIds);
    if (ledgerErr) throw ledgerErr;

    const scores = new Map();
    for (const row of ledgerRows || []) {
      scores.set(row.user_id, (scores.get(row.user_id) || 0) + (row.delta || 0));
    }

    const leaderboard = [...scores.entries()]
      .map(([userId, score]) => ({ user_id: userId, score }))
      .sort((left, right) => right.score - left.score);

    return res.status(200).json(leaderboard);
  } catch (err) {
    console.error('leaderboard error', err);
    return res.status(500).json({ error: 'internal server error' });
  }
}
