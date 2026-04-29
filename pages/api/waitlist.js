const { supabase } = require('../../server/supabaseClient');
const { applyCors } = require('../../server/cors');

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const { email, name, source } = req.body || {};
  if (!email || typeof email !== 'string') return res.status(400).json({ error: 'email required' });

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  if (!emailOk) return res.status(400).json({ error: 'invalid email' });

  try {
    const insert = { email: email.toLowerCase(), name: name || null, source: source || null };
    const { data, error } = await supabase.from('waitlist').insert([insert]).select();
    if (error) {
      if ((error.message && error.message.toLowerCase().includes('duplicate')) || error.code === '23505') {
        return res.status(200).json({ message: 'already signed up' });
      }
      console.error('Supabase insert error', error);
      return res.status(500).json({ error: 'db_error', details: error.message || error });
    }
    return res.status(200).json({ success: true, entry: data && data[0] ? data[0] : null });
  } catch (e) {
    console.error('Waitlist error', e);
    return res.status(500).json({ error: 'internal' });
  }
};
