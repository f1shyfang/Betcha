const { applyCors } = require('../../server/cors');

async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const { email, name, source } = req.body || {};
  if (!email || typeof email !== 'string') return res.status(400).json({ error: 'email required' });

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  if (!emailOk) return res.status(400).json({ error: 'invalid email' });

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'waitlist_not_configured' });
    }

    const insert = { email: email.toLowerCase(), name: name || null, source: source || null };
    const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/waitlist?on_conflict=email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: 'resolution=ignore-duplicates,return=representation'
      },
      body: JSON.stringify(insert)
    });

    if (!response.ok) {
      const details = await response.text();
      console.error('Supabase insert error', response.status, details);
      return res.status(response.status).json({ error: 'db_error', details });
    }

    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      return res.status(200).json({ success: true, entry: data[0] });
    }

    return res.status(200).json({ success: true, entry: data && data[0] ? data[0] : null });
  } catch (e) {
    console.error('Waitlist error', e);
    return res.status(500).json({ error: 'internal' });
  }
}

module.exports = handler;
module.exports.default = handler;
