const express = require('express');
const bodyParser = require('body-parser');
const { supabase } = require('./supabaseClient');

function createApp(deps) {
  const {
    db,
    getIdempotentResponse,
    storeIdempotentResponse
  } = deps;

  const app = express();
  app.use(bodyParser.json());
  // Populate req.user from Supabase auth (if Authorization header present)
  const supabaseAuth = require('./supabaseAuth');
  app.use(supabaseAuth);
  // CORS: allow frontend origin configured via FRONTEND_URL (or allow all in dev)
  const cors = require('cors');
  const frontendOrigin = process.env.FRONTEND_URL || process.env.VERCEL_URL ? (process.env.FRONTEND_URL || `https://${process.env.VERCEL_URL}`) : '*';
  app.use(cors({ origin: frontendOrigin, credentials: true }));

  // Waitlist submission endpoint — stores email + name in Supabase
  app.post('/api/waitlist', async (req, res) => {
    const { email, name, source } = req.body || {};
    if (!email || typeof email !== 'string') return res.status(400).json({ error: 'email required' });
    // simple email check
    const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
    if (!emailOk) return res.status(400).json({ error: 'invalid email' });

    try {
      const insert = { email: email.toLowerCase(), name: name || null, source: source || null };
      const { data, error } = await supabase.from('waitlist').insert([insert]).select();
      if (error) {
        // If duplicate, return ok (idempotent)
        if (error.message && error.message.toLowerCase().includes('duplicate') || error.code === '23505') {
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
  });

  const { handleResolve } = require('./resolveHandler');

  app.get('/health', (req, res) => {
    return res.status(200).json({ ok: true });
  });

  app.post('/api/markets/:id/resolve', async (req, res) => {
    const marketId = req.params.id;
    const { outcome, method = 'creator', reason = '' } = req.body;
    const idempKey = req.get('Idempotency-Key');

    const result = await handleResolve({ marketId, outcome, method, reason, idempKey, db, getIdempotentResponse, storeIdempotentResponse, userId: req.user && req.user.id });
    return res.status(result.status).json(result.body);
  });

  return app;
}

module.exports = { createApp };
