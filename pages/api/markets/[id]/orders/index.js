import { getUserFromRequest } from '../../../../../lib/auth';
import { applyCors } from '../../../../../server/cors';
import { query, getClient } from '../../../../../server/db';
import { getIdempotentResponse, storeIdempotentResponse } from '../../../../../server/idempotency';
import { placeOrder } from '../../../../../server/exchange/executor';
import { requoteBot } from '../../../../../server/exchange/botDriver';

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

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const marketId = req.query.id;
  const { side, price, qty, type } = req.body || {};

  // Validate inputs
  if (!['buy', 'sell'].includes(side)) {
    return res.status(400).json({ error: 'side must be buy or sell' });
  }
  const qtyNum = Number(qty);
  if (!Number.isInteger(qtyNum) || qtyNum <= 0) {
    return res.status(400).json({ error: 'qty must be a positive integer' });
  }
  if (type !== 'limit' && type !== 'market') {
    return res.status(400).json({ error: 'type must be limit or market' });
  }
  if (type === 'limit') {
    const priceNum = Number(price);
    if (!Number.isInteger(priceNum) || priceNum < 1 || priceNum > 99) {
      return res.status(400).json({ error: 'price must be an integer between 1 and 99 for limit orders' });
    }
  }

  const idempKey = req.headers['idempotency-key'];

  try {
    if (idempKey) {
      const prior = await getIdempotentResponse(idempKey);
      if (prior) return res.status(200).json(prior);
    }

    const memberStatus = await loadMarketWithMembership(marketId, user.id);
    if (memberStatus.notFound) return res.status(404).json({ error: 'market not found' });
    if (memberStatus.forbidden) return res.status(403).json({ error: 'forbidden' });

    const result = await placeOrder(
      { marketId, userId: user.id, side, price: Number(price), qty: qtyNum, type },
      { getClient }
    );

    if (result.status === 'error') {
      // All executor business-logic rejections map to 400 with the error code.
      return res.status(400).json({ error: result.error });
    }

    if (idempKey) await storeIdempotentResponse(idempKey, result);

    // Best-effort requote: placeOrder has already committed, so this is safe.
    // A requote failure must never surface as an order error.
    try {
      await requoteBot(marketId, { getClient, query });
    } catch (e) {
      console.error('bot requote after order failed', e);
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('place order error', err);
    return res.status(500).json({ error: 'internal server error' });
  }
}
