import { getUserFromRequest } from '../../../../lib/auth';
import { applyCors } from '../../../../server/cors';
import { query, getClient } from '../../../../server/db';
import { runLiquidations } from '../../../../server/exchange/liquidationDriver';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const marketId = req.query.id;

  try {
    const { liquidated } = await runLiquidations(marketId, { getClient, query });
    return res.status(200).json({ liquidated });
  } catch (err) {
    console.error('liquidate endpoint error', err);
    return res.status(500).json({ error: 'internal server error' });
  }
}
