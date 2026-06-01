import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uid } from './helpers.js';
const { query, pool, getClient } = require('../server/db');
const { createExchangeMarket } = require('../server/exchange/createMarket');
const { placeOrder } = require('../server/exchange/executor');
const { cancelOrder } = require('../server/exchange/cancelOrder');
const { availableCash } = require('../server/exchange/accounts');

const USER = uid('cx-user');
let GROUP, marketId;

beforeAll(async () => {
  await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100000) ON CONFLICT (id) DO NOTHING`, [USER, `${USER}@t.internal`]);
  const g = await query(`INSERT INTO groups (name, owner_id) VALUES ('g',$1) RETURNING id`, [USER]);
  GROUP = g.rows[0].id;
  ({ marketId } = await createExchangeMarket({ groupId: GROUP, creatorId: USER, title: 'cancel test' }, query));
});
afterAll(async () => { await pool.end(); });

describe('cancelOrder', () => {
  it('cancels a resting buy and frees its escrow', async () => {
    const before = await availableCash(USER, query);
    const placed = await placeOrder({ marketId, userId: USER, side: 'buy', price: 50, qty: 10, type: 'limit' }, { getClient });
    expect(await availableCash(USER, query)).toBe(before - 500); // escrow held
    const res = await cancelOrder({ orderId: placed.orderId, userId: USER }, { getClient });
    expect(res.status).toBe('ok');
    expect(await availableCash(USER, query)).toBe(before); // escrow freed
    const { rows } = await query(`SELECT status FROM orders WHERE id=$1`, [placed.orderId]);
    expect(rows[0].status).toBe('cancelled');
  });

  it('refuses to cancel an order the user does not own', async () => {
    const other = uid('cx-other');
    await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100000) ON CONFLICT (id) DO NOTHING`, [other, `${other}@t.internal`]);
    const placed = await placeOrder({ marketId, userId: USER, side: 'buy', price: 40, qty: 5, type: 'limit' }, { getClient });
    const res = await cancelOrder({ orderId: placed.orderId, userId: other }, { getClient });
    expect(res.status).toBe('error');
    expect(res.error).toBe('forbidden');
  });
});
