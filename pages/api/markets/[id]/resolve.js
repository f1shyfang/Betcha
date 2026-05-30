import { handleResolve } from '../../../../server/resolveHandler';
import { getIdempotentResponse, storeIdempotentResponse } from '../../../../server/idempotency';
import { getUserFromRequest } from '../../../../lib/auth';
import { applyCors } from '../../../../server/cors';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  try {
    const marketId = req.query.id;
    const { outcome, method = 'creator', reason = '', evidence_image_url = '' } = req.body || {};
    const idempKey = req.headers['idempotency-key'];
    const user = await getUserFromRequest(req);

    if (!user) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const reasonWithEvidence = evidence_image_url
      ? `${reason}\nEvidence: ${evidence_image_url}`.trim()
      : reason;

    const result = await handleResolve({
      marketId,
      outcome,
      method,
      reason: reasonWithEvidence,
      idempKey,
      getIdempotentResponse,
      storeIdempotentResponse,
      userId: user.id,
    });
    return res.status(result.status).json(result.body);
  } catch (e) {
    console.error('resolve route error', e);
    return res.status(500).json({ error: 'internal' });
  }
}
