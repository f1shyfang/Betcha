const { handleResolve } = require('../../../../server/resolveHandler');
const { getIdempotentResponse, storeIdempotentResponse } = require('../../../../server/idempotency');
const { getUserFromRequest } = require('../../../../server/supabaseAuth');
const { applyCors } = require('../../../../server/cors');

async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  try {
    const marketId = req.query.id;
    const { outcome, method = 'creator', reason = '' } = req.body || {};
    const idempKey = req.headers['idempotency-key'];
    const user = await getUserFromRequest(req);

    if (!user) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const result = await handleResolve({
      marketId,
      outcome,
      method,
      reason,
      idempKey,
      getIdempotentResponse,
      storeIdempotentResponse,
      userId: user.id
    });
    return res.status(result.status).json(result.body);
  } catch (e) {
    console.error('resolve route error', e);
    return res.status(500).json({ error: 'internal' });
  }
}

module.exports = handler;
module.exports.default = handler;
