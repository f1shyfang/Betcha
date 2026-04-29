const db = require('../../../../server/db');
const { getUserFromRequest } = require('../../../../server/supabaseAuth');
const { applyCors } = require('../../../../server/cors');
const { getIdempotentResponse, storeIdempotentResponse } = require('../../../../server/idempotency');

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  const marketId = req.query.id;
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
    return res.status(500).json({ error: 'internal server error' });
  }
}
