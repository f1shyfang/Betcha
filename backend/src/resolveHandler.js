// Shared resolve market logic — used by both Express app and Vercel serverless function
const handleResolve = async (deps) => {
  const { marketId, outcome, method = 'creator', reason = '', idempKey, db, getIdempotentResponse, storeIdempotentResponse, userId } = deps;

  try {
    const prior = await getIdempotentResponse(idempKey);
    if (prior) return { status: 200, body: prior };

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const m = await client.query('SELECT state FROM markets WHERE id = $1 FOR UPDATE', [marketId]);
      if (m.rowCount === 0) {
        await client.query('ROLLBACK');
        return { status: 404, body: { error: 'market not found' } };
      }
      if (m.rows[0].state !== 'open') {
        await client.query('ROLLBACK');
        return { status: 409, body: { error: 'market not open' } };
      }

      const insertRes = await client.query(
        'INSERT INTO resolutions (market_id, resolver_id, outcome, method, reason) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at',
        [marketId, userId || null, outcome, method, reason]
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
      return { status: 200, body: response };
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505') {
        const existing = await db.query('SELECT id, outcome, created_at FROM resolutions WHERE market_id = $1', [marketId]);
        if (existing.rowCount) {
          const resp = { market_id: marketId, resolution_id: existing.rows[0].id, outcome: existing.rows[0].outcome };
          await storeIdempotentResponse(idempKey, resp);
          return { status: 200, body: resp };
        }
      }
      console.error('Resolve error', err);
      return { status: 500, body: { error: 'internal' } };
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Unexpected error', e);
    return { status: 500, body: { error: 'internal' } };
  }
};

module.exports = { handleResolve };
