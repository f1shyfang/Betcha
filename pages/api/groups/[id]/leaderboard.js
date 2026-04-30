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
      .select('user_id,market_id,delta,reason,created_at')
      .in('market_id', marketIds);
    if (ledgerErr) throw ledgerErr;

    const scores = new Map();
    const history = new Map();
    for (const row of ledgerRows || []) {
      scores.set(row.user_id, (scores.get(row.user_id) || 0) + (row.delta || 0));
      if (!history.has(row.user_id)) history.set(row.user_id, []);
      history.get(row.user_id).push({
        delta: row.delta || 0,
        reason: row.reason,
        created_at: row.created_at,
      });
    }

    const { data: groupMemberRows, error: groupMemberErr } = await supabaseAdmin
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId);
    if (groupMemberErr) throw groupMemberErr;

    const scoredUserIds = [...new Set((groupMemberRows || []).map((row) => row.user_id).filter(Boolean))];
    if (scoredUserIds.length === 0) return res.status(200).json([]);

    const { data: userRows, error: userErr } = await supabaseAdmin
      .from('users')
      .select('id,email,display_name,starting_points')
      .in('id', scoredUserIds);
    if (userErr) throw userErr;

    const userMap = new Map((userRows || []).map((u) => [u.id, u]));

    const leaderboard = [...scores.entries()]
      .map(([userId, score]) => {
        const u = userMap.get(userId);
        const display_name = u?.display_name ?? (u?.email ? u.email.split('@')[0] : userId);
        const balance = (u?.starting_points ?? 2000) + score;
        const recent = (history.get(userId) || [])
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .slice(0, 5);
        const trendWindow = recent.slice(0, 3).reduce((sum, row) => sum + row.delta, 0);
        const trend = trendWindow > 0 ? 'up' : (trendWindow < 0 ? 'down' : 'flat');
        return { user_id: userId, display_name, score: balance, raw_delta: score, last_deltas: recent, trend };
      })
      .sort((left, right) => right.score - left.score);

    return res.status(200).json(leaderboard);
  } catch (err) {
    console.error('leaderboard error', err);
    return res.status(500).json({ error: 'internal server error' });
  }
}
