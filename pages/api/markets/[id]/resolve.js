const { handleResolve } = require('../../../../server/resolveHandler');
const db = require('../../../../server/db');
const { getIdempotentResponse, storeIdempotentResponse } = require('../../../../server/idempotency');
const { getUserFromRequest } = require('../../../../server/supabaseAuth');
const { applyCors } = require('../../../../server/cors');

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  try {
    const marketId = req.query.id;
    const { outcome, method = 'creator', reason = '' } = req.body || {};
    const idempKey = req.headers['idempotency-key'];
    const user = await getUserFromRequest(req);

    const result = await handleResolve({
      marketId,
      outcome,
      method,
      reason,
      idempKey,
      db,
      getIdempotentResponse,
      storeIdempotentResponse,
      userId: user && user.id
    });
    return res.status(result.status).json(result.body);
  } catch (e) {
    console.error('resolve route error', e);
    return res.status(500).json({ error: 'internal' });
  }
};
