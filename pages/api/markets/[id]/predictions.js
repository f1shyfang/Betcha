import { getUserFromRequest } from '../../../../lib/auth';
import { applyCors } from '../../../../server/cors';
import { query } from '../../../../server/db';
import { getUserBalance } from '../../../../server/queries/balance';
import { getIdempotentResponse, storeIdempotentResponse } from '../../../../server/idempotency';

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

async function listPredictions(marketId, userId) {
  const marketStatus = await loadMarketWithMembership(marketId, userId);
  if (marketStatus.notFound) return { status: 404, body: { error: 'market not found' } };
  if (marketStatus.forbidden) return { status: 403, body: { error: 'forbidden' } };

  const { rows } = await query(
    'SELECT user_id, choice, stake_points, created_at FROM predictions WHERE market_id = $1 ORDER BY created_at DESC',
    [marketId]
  );

  const userIds = [...new Set(rows.map((p) => p.user_id))];
  let userMap = new Map();
  if (userIds.length > 0) {
    const { rows: userRows } = await query(
      'SELECT id, email, display_name FROM users WHERE id = ANY($1)',
      [userIds]
    );
    userMap = new Map(userRows.map((u) => [u.id, u]));
  }

  const enriched = rows.map((p) => {
    const u = userMap.get(p.user_id);
    return {
      ...p,
      display_name: u?.display_name ?? (u?.email ? u.email.split('@')[0] : p.user_id),
    };
  });

  return { status: 200, body: enriched };
}

async function createPrediction(marketId, userId, userEmail, choice, stakePoints) {
  const marketStatus = await loadMarketWithMembership(marketId, userId);
  if (marketStatus.notFound) return { status: 404, body: { error: 'market not found' } };
  if (marketStatus.forbidden) return { status: 403, body: { error: 'forbidden' } };
  if (marketStatus.market.state !== 'open') return { status: 400, body: { error: 'market is not open' } };

  await query(
    `INSERT INTO users (id, email) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
    [userId, userEmail]
  );

  const balance = await getUserBalance(userId);
  if (stakePoints > balance) {
    return { status: 400, body: { error: 'insufficient points', balance } };
  }

  let prediction;
  try {
    const { rows } = await query(
      `INSERT INTO predictions (market_id, user_id, choice, stake_points)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [marketId, userId, choice, stakePoints]
    );
    prediction = rows[0];
  } catch (error) {
    if (error.code === '23505') {
      return { status: 409, body: { error: 'prediction already placed for this market' } };
    }
    throw error;
  }

  await query(
    `INSERT INTO ledger_entries (user_id, market_id, delta, reason)
     VALUES ($1, $2, $3, 'wager_stake')`,
    [userId, marketId, -stakePoints]
  );

  return { status: 200, body: prediction || null };
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  const marketId = req.query.id;
  if (req.method === 'GET') {
    try {
      const result = await listPredictions(marketId, user.id);
      return res.status(result.status).json(result.body);
    } catch (err) {
      console.error('prediction list error', err);
      return res.status(500).json({ error: 'internal server error' });
    }
  }

  if (req.method === 'POST') {
    const { choice, stake_points } = req.body;
    if (typeof choice !== 'boolean') return res.status(400).json({ error: 'choice boolean is required' });
    const stakePoints = Number(stake_points);
    if (!Number.isInteger(stakePoints) || stakePoints <= 0) {
      return res.status(400).json({ error: 'stake_points positive integer is required' });
    }

    const idempKey = req.headers['idempotency-key'];

    try {
      if (idempKey) {
        const prior = await getIdempotentResponse(idempKey);
        if (prior) return res.status(200).json(prior);
      }

      const result = await createPrediction(marketId, user.id, user.email, choice, stakePoints);
      if (idempKey && result.status === 200) await storeIdempotentResponse(idempKey, result.body);

      return res.status(result.status).json(result.body);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'internal server error' });
    }
  }

  return res.status(405).json({ error: 'method not allowed' });
}
