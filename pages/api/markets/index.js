import { getUserFromRequest } from '../../../lib/auth';
import { applyCors } from '../../../server/cors';
import { query } from '../../../server/db';
import { getIdempotentResponse, storeIdempotentResponse } from '../../../server/idempotency';

async function assertGroupMembership(groupId, userId) {
  const { rows } = await query(
    'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1',
    [groupId, userId]
  );
  return rows.length > 0;
}

async function createMarket(user, payload) {
  const { group_id, title, resolve_by } = payload;

  const isMember = await assertGroupMembership(group_id, user.id);
  if (!isMember) return { forbidden: true };

  const { rows } = await query(
    `INSERT INTO markets (group_id, creator_id, title, resolve_by)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [group_id, user.id, title, resolve_by || null]
  );
  return { market: rows[0] };
}

async function attachPredictionCounts(markets) {
  const marketIds = (markets || []).map((market) => market.id).filter(Boolean);
  if (marketIds.length === 0) return markets;

  const { rows: predictionRows } = await query(
    'SELECT market_id FROM predictions WHERE market_id = ANY($1)',
    [marketIds]
  );

  const counts = new Map();
  for (const row of predictionRows) {
    counts.set(row.market_id, (counts.get(row.market_id) || 0) + 1);
  }

  return markets.map((market) => ({
    ...market,
    prediction_count: counts.get(market.id) || 0,
  }));
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method === 'POST') {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });

    const { group_id, title, resolve_by } = req.body;
    if (!group_id || !title) return res.status(400).json({ error: 'group_id and title are required' });

    const idempKey = req.headers['idempotency-key'];

    try {
      if (idempKey) {
        const prior = await getIdempotentResponse(idempKey);
        if (prior) return res.status(200).json(prior);
      }

      const result = await createMarket(user, { group_id, title, resolve_by });
      if (result.forbidden) return res.status(403).json({ error: 'forbidden' });
      if (idempKey) await storeIdempotentResponse(idempKey, result.market);
      return res.status(200).json(result.market);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'internal server error' });
    }
  } else if (req.method === 'GET') {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });

    const { group_id } = req.query;

    try {
      if (group_id) {
        const allowed = await assertGroupMembership(group_id, user.id);
        if (!allowed) return res.status(403).json({ error: 'forbidden' });

        const { rows: marketRows } = await query(
          'SELECT * FROM markets WHERE group_id = $1 ORDER BY created_at DESC',
          [group_id]
        );
        const markets = await attachPredictionCounts(marketRows);
        return res.status(200).json(markets);
      }

      const { rows: memberRows } = await query(
        'SELECT group_id FROM group_members WHERE user_id = $1',
        [user.id]
      );
      const groupIds = [...new Set(memberRows.map((row) => row.group_id).filter(Boolean))];
      if (groupIds.length === 0) {
        return res.status(200).json([]);
      }

      const { rows: marketRows } = await query(
        'SELECT * FROM markets WHERE group_id = ANY($1) ORDER BY created_at DESC',
        [groupIds]
      );
      const markets = await attachPredictionCounts(marketRows);
      return res.status(200).json(markets);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'internal server error' });
    }
  }

  res.status(405).json({ error: 'method not allowed' });
}
