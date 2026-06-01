import { getUserFromRequest } from '../../../../lib/auth';
import { applyCors } from '../../../../server/cors';
import { query } from '../../../../server/db';
import { getExchangeState } from '../../../../server/exchange/exchangeState';

async function loadMarketWithMembership(marketId, userId) {
  const { rows: marketRows } = await query(
    'SELECT id, group_id, state FROM markets WHERE id = $1 LIMIT 1',
    [marketId]
  );
  const market = marketRows[0];
  if (!market) return { notFound: true };

  const { rows: memberRows } = await query(
    'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1',
    [market.group_id, userId]
  );
  if (memberRows.length === 0) return { forbidden: true };

  return { market };
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const marketId = req.query.id;

  try {
    const memberStatus = await loadMarketWithMembership(marketId, user.id);
    if (memberStatus.notFound) return res.status(404).json({ error: 'market not found' });
    if (memberStatus.forbidden) return res.status(403).json({ error: 'forbidden' });

    const state = await getExchangeState(marketId, user.id, query);
    return res.status(200).json(state);
  } catch (err) {
    console.error('exchange state error', err);
    return res.status(500).json({ error: 'internal server error' });
  }
}
