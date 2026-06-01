import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uid } from './helpers.js';
const { query, pool, getClient } = require('../server/db');
const { createExchangeMarket } = require('../server/exchange/createMarket');
const { placeOrder } = require('../server/exchange/executor');
const { getExchangeState } = require('../server/exchange/exchangeState');

const SELLER = uid('st-seller');
const BUYER = uid('st-buyer');
let GROUP, marketId;

beforeAll(async () => {
  await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100000),($3,$4,100000) ON CONFLICT (id) DO NOTHING`,
    [SELLER, `${SELLER}@t.internal`, BUYER, `${BUYER}@t.internal`]);
  const g = await query(`INSERT INTO groups (name, owner_id) VALUES ('g',$1) RETURNING id`, [SELLER]);
  GROUP = g.rows[0].id;
  await query(`INSERT INTO group_members (group_id, user_id) VALUES ($1,$2),($1,$3) ON CONFLICT DO NOTHING`, [GROUP, SELLER, BUYER]);
  ({ marketId } = await createExchangeMarket({ groupId: GROUP, creatorId: SELLER, title: 'state test' }, query));
  await query(`INSERT INTO positions (market_id, user_id, shares, avg_entry) VALUES ($1,$2,100,50)`, [marketId, SELLER]);
  await placeOrder({ marketId, userId: SELLER, side: 'sell', price: 63, qty: 10, type: 'limit' }, { getClient });
  await placeOrder({ marketId, userId: SELLER, side: 'sell', price: 65, qty: 10, type: 'limit' }, { getClient });
  await placeOrder({ marketId, userId: BUYER, side: 'buy', price: 63, qty: 4, type: 'limit' }, { getClient }); // crosses -> 1 trade
});
afterAll(async () => { await pool.end(); });

describe('getExchangeState', () => {
  it('returns the book ladder, mark, last trade, my position and my open orders', async () => {
    const state = await getExchangeState(marketId, BUYER, query);
    expect(state.book.asks).toEqual(expect.arrayContaining([{ price: 63, qty: 6 }, { price: 65, qty: 10 }]));
    expect(state.lastTrade).toBe(63);
    expect(state.myPosition.shares).toBe(4);
    expect(Array.isArray(state.myOpenOrders)).toBe(true);
    expect(typeof state.mark).toBe('number');
  });
});
