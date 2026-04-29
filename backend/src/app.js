const express = require('express');
const bodyParser = require('body-parser');

function createApp(deps) {
  const {
    db,
    getIdempotentResponse,
    storeIdempotentResponse
  } = deps;

  const app = express();
  app.use(bodyParser.json());

  app.post('/api/markets/:id/resolve', async (req, res) => {
    const marketId = req.params.id;
    const { outcome, method = 'creator', reason = '' } = req.body;
    const idempKey = req.get('Idempotency-Key');

    try {
      const prior = await getIdempotentResponse(idempKey);
      if (prior) return res.status(200).json(prior);

      const client = await db.getClient();
      try {
        await client.query('BEGIN');

        const m = await client.query('SELECT state FROM markets WHERE id = $1 FOR UPDATE', [marketId]);
        if (m.rowCount === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'market not found' });
        }
        if (m.rows[0].state !== 'open') {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'market not open' });
        }

        const insertRes = await client.query(
          'INSERT INTO resolutions (market_id, resolver_id, outcome, method, reason) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at',
          [marketId, req.user && req.user.id || null, outcome, method, reason]
        );

        await client.query(
          'UPDATE markets SET state = $1, resolution = $2 WHERE id = $3',
          ['resolved', JSON.stringify({ outcome, resolved_at: new Date().toISOString() }), marketId]
        );

        const preds = await client.query('SELECT user_id, choice FROM predictions WHERE market_id = $1', [marketId]);
        for (const p of preds.rows) {
          const delta = (p.choice === outcome) ? 1 : -1;
          await client.query(
            'INSERT INTO ledger_entries (user_id, market_id, delta, reason) VALUES ($1,$2,$3,$4)',
            [p.user_id, marketId, delta, p.choice === outcome ? 'win' : 'loss']
          );
        }

        await client.query('COMMIT');

        const response = { market_id: marketId, resolution_id: insertRes.rows[0].id, outcome };
        await storeIdempotentResponse(idempKey, response);
        return res.status(200).json(response);
      } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23505') {
          const existing = await db.query('SELECT id, outcome, created_at FROM resolutions WHERE market_id = $1', [marketId]);
          if (existing.rowCount) {
            const resp = { market_id: marketId, resolution_id: existing.rows[0].id, outcome: existing.rows[0].outcome };
            await storeIdempotentResponse(idempKey, resp);
            return res.status(200).json(resp);
          }
        }
        console.error('Resolve error', err);
        return res.status(500).json({ error: 'internal' });
      } finally {
        client.release();
      }
    } catch (e) {
      console.error('Unexpected error', e);
      return res.status(500).json({ error: 'internal' });
    }
  });

  return app;
}

module.exports = { createApp };
