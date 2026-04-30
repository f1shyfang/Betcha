const { getUserFromRequest } = require('../../../../server/supabaseAuth');
const { applyCors } = require('../../../../server/cors');
const crypto = require('crypto');
const { requireSupabaseAdmin } = require('../../../../server/supabaseAdmin');

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
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

    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    const { data: invite, error: inviteErr } = await supabaseAdmin
      .from('invites')
      .insert({ group_id: groupId, token, inviter_id: user.id, expires_at: expiresAt.toISOString() })
      .select('token,expires_at')
      .single();
    if (inviteErr) throw inviteErr;

    return res.status(200).json(invite);
  } catch (err) {
    console.error('invite error', err);
    return res.status(500).json({ error: 'internal server error' });
  }
}
