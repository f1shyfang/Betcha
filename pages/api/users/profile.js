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

  const { display_name } = req.body;

  try {
    const supabaseAdmin = requireSupabaseAdmin();
    const { error } = await supabaseAdmin
      .from('users')
      .upsert({ id: user.id, email: user.email, display_name: display_name || null }, { onConflict: 'id' });
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('profile upsert error', err);
    return res.status(500).json({ error: 'internal server error' });
  }
}
