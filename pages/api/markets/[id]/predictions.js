const db = require('../../../../server/db');
const { getUserFromRequest } = require('../../../../server/supabaseAuth');
const { applyCors } = require('../../../../server/cors');
const { getIdempotentResponse, storeIdempotentResponse } = require('../../../../server/idempotency');
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

async function loadMarketWithMembership(marketId, userId) {
  if (!supabaseAdmin) throw new Error('supabase_admin_not_configured');

  const { data: marketRows, error: marketErr } = await supabaseAdmin
    .from('markets')
    .select('id,group_id,state')
    .eq('id', marketId)
    .limit(1);
  if (marketErr) throw marketErr;
  const market = marketRows?.[0];
  if (!market) return { notFound: true };

  const { data: memberRows, error: memberErr } = await supabaseAdmin
    .from('group_members')
    .select('role')
    .eq('group_id', market.group_id)
    .eq('user_id', userId)
    .limit(1);
  if (memberErr) throw memberErr;
  if (!memberRows || memberRows.length === 0) return { forbidden: true };

  return { market };
}

async function listPredictionsViaSupabase(marketId, userId) {
  const marketStatus = await loadMarketWithMembership(marketId, userId);
  if (marketStatus.notFound) return { status: 404, body: { error: 'market not found' } };
  if (marketStatus.forbidden) return { status: 403, body: { error: 'forbidden' } };

  const { data, error } = await supabaseAdmin
    .from('predictions')
    .select('user_id,choice,created_at')
    .eq('market_id', marketId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  return { status: 200, body: data || [] };
}

async function upsertPredictionViaSupabase(marketId, userId, userEmail, choice) {
  const marketStatus = await loadMarketWithMembership(marketId, userId);
  if (marketStatus.notFound) return { status: 404, body: { error: 'market not found' } };
  if (marketStatus.forbidden) return { status: 403, body: { error: 'forbidden' } };
  if (marketStatus.market.state !== 'open') return { status: 400, body: { error: 'market is not open' } };

  // Keep compatibility with existing schema that expects a users row.
  const { error: userErr } = await supabaseAdmin
    .from('users')
    .upsert({ id: userId, email: userEmail }, { onConflict: 'id' });
  if (userErr) throw userErr;

  const { data, error } = await supabaseAdmin
    .from('predictions')
    .upsert({ market_id: marketId, user_id: userId, choice, created_at: new Date().toISOString() }, { onConflict: 'market_id,user_id' })
    .select('*')
    .limit(1);
  if (error) throw error;

  return { status: 200, body: data?.[0] || null };
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  const marketId = req.query.id;
  if (req.method === 'GET') {
    try {
      const market = await db.query('SELECT group_id FROM markets WHERE id = $1', [marketId]);
      if (market.rowCount === 0) return res.status(404).json({ error: 'market not found' });

      const member = await db.query(
        'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
        [market.rows[0].group_id, user.id]
      );
      if (member.rowCount === 0) return res.status(403).json({ error: 'forbidden' });

      const preds = await db.query(
        'SELECT user_id, choice, created_at FROM predictions WHERE market_id = $1 ORDER BY created_at DESC',
        [marketId]
      );

      return res.status(200).json(preds.rows);
    } catch (err) {
      console.error('prediction list error', err);
      if (err?.code === 'ECONNREFUSED') {
        try {
          const fallback = await listPredictionsViaSupabase(marketId, user.id);
          return res.status(fallback.status).json(fallback.body);
        } catch (fallbackErr) {
          console.error('prediction list supabase fallback error', fallbackErr);
        }
      }
      return res.status(500).json({ error: 'internal server error' });
    }
  }

  if (req.method === 'POST') {
    const { choice } = req.body;
    if (typeof choice !== 'boolean') return res.status(400).json({ error: 'choice boolean is required' });

    const idempKey = req.headers['idempotency-key'];

    try {
      if (idempKey) {
        const prior = await getIdempotentResponse(idempKey);
        if (prior) return res.status(200).json(prior);
      }

      // Upsert user
      await db.query(`INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [user.id, user.email]);

      const client = await db.getClient();
      try {
        await client.query('BEGIN');

        const market = await client.query('SELECT group_id, state FROM markets WHERE id = $1', [marketId]);
        if (market.rowCount === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'market not found' });
        }
        if (market.rows[0].state !== 'open') {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'market is not open' });
        }

        // Verify membership
        const member = await client.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [market.rows[0].group_id, user.id]);
        if (member.rowCount === 0) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'forbidden' });
        }

        const pred = await client.query(
          'INSERT INTO predictions (market_id, user_id, choice) VALUES ($1, $2, $3) ON CONFLICT (market_id, user_id) DO UPDATE SET choice = EXCLUDED.choice, created_at = now() RETURNING *',
          [marketId, user.id, choice]
        );

        await client.query('COMMIT');

        const responseBody = pred.rows[0];
        if (idempKey) await storeIdempotentResponse(idempKey, responseBody);
        
        return res.status(200).json(responseBody);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('predict error', err);
        return res.status(500).json({ error: 'internal server error' });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error(err);
      if (err?.code === 'ECONNREFUSED') {
        try {
          const fallback = await upsertPredictionViaSupabase(marketId, user.id, user.email, choice);
          return res.status(fallback.status).json(fallback.body);
        } catch (fallbackErr) {
          console.error('prediction write supabase fallback error', fallbackErr);
        }
      }
      return res.status(500).json({ error: 'internal server error' });
    }
  }

  return res.status(405).json({ error: 'method not allowed' });
}
