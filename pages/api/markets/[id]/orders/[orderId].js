import { getUserFromRequest } from '../../../../../lib/auth';
import { applyCors } from '../../../../../server/cors';
import { getClient } from '../../../../../server/db';
import { cancelOrder } from '../../../../../server/exchange/cancelOrder';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const orderId = req.query.orderId;

  try {
    const result = await cancelOrder({ orderId, userId: user.id }, { getClient });

    if (result.status === 'error') {
      if (result.error === 'forbidden') return res.status(403).json({ error: 'forbidden' });
      if (result.error === 'not_found') return res.status(404).json({ error: 'not found' });
      if (result.error === 'not_cancellable') return res.status(409).json({ error: 'order is not cancellable' });
      return res.status(400).json({ error: result.error });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('cancel order error', err);
    return res.status(500).json({ error: 'internal server error' });
  }
}
