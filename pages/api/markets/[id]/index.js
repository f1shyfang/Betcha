import { applyCors } from '../../../../server/cors';
import { getUserFromRequest } from '../../../../lib/auth';
import { getMarketDetail } from '../../../../server/queries/marketDetail';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  try {
    const result = await getMarketDetail(req.query.id, user.id);
    return res.status(result.status).json(result.body);
  } catch (e) {
    console.error('market detail error', e);
    return res.status(500).json({ error: 'internal' });
  }
}
