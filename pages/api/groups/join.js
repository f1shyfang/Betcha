const { getUserFromRequest } = require('../../../server/supabaseAuth');
const { applyCors } = require('../../../server/cors');
const { requireSupabaseAdmin } = require('../../../server/supabaseAdmin');

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token is required' });

  try {
    const supabaseAdmin = requireSupabaseAdmin();

    const { error: userErr } = await supabaseAdmin
      .from('users')
      .upsert({ id: user.id, email: user.email }, { onConflict: 'id' });
    if (userErr) throw userErr;

    const { data: inviteRows, error: inviteErr } = await supabaseAdmin
      .from('invites')
      .select('id,group_id')
      .eq('token', token)
      .gt('expires_at', new Date().toISOString())
      .is('used_by_user_id', null)
      .limit(1);
    if (inviteErr) throw inviteErr;

    const invite = inviteRows?.[0];
    if (!invite) {
      return res.status(400).json({ error: 'invalid or expired token' });
    }

    const { error: memberErr } = await supabaseAdmin
      .from('group_members')
      .upsert({ group_id: invite.group_id, user_id: user.id }, { onConflict: 'group_id,user_id' });
    if (memberErr) throw memberErr;

    const { data: claimRows, error: claimErr } = await supabaseAdmin
      .from('invites')
      .update({ used_by_user_id: user.id })
      .eq('id', invite.id)
      .is('used_by_user_id', null)
      .select('id')
      .limit(1);
    if (claimErr) throw claimErr;
    if (!claimRows || claimRows.length === 0) {
      return res.status(400).json({ error: 'invalid or expired token' });
    }

    return res.status(200).json({ group_id: invite.group_id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'internal server error' });
  }
}
