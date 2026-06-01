import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uid } from './helpers.js';
const { query, pool } = require('../server/db');
const { createExchangeMarket } = require('../server/exchange/createMarket');
const { availableCash, sellableShares } = require('../server/exchange/accounts');

const USER = uid('ac-user');
let GROUP, marketId;

beforeAll(async () => {
  await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,2000) ON CONFLICT (id) DO NOTHING`, [USER, `${USER}@t.internal`]);
  const g = await query(`INSERT INTO groups (name, owner_id) VALUES ('g',$1) RETURNING id`, [USER]);
  GROUP = g.rows[0].id;
  ({ marketId } = await createExchangeMarket({ groupId: GROUP, creatorId: USER, title: 'acct test' }, query));
  await query(`INSERT INTO ledger_entries (user_id, market_id, delta, reason) VALUES ($1,$2,-300,'buy_fill')`, [USER, marketId]);
  await query(`INSERT INTO orders (market_id, user_id, side, price, quantity, filled_quantity, status) VALUES ($1,$2,'buy',60,10,0,'open')`, [marketId, USER]);
  await query(`INSERT INTO positions (market_id, user_id, shares, avg_entry) VALUES ($1,$2,12,50)`, [marketId, USER]);
  await query(`INSERT INTO orders (market_id, user_id, side, price, quantity, filled_quantity, status) VALUES ($1,$2,'sell',70,4,0,'open')`, [marketId, USER]);
});
afterAll(async () => { await pool.end(); });

describe('availableCash', () => {
  it('is starting + ledger - resting buy escrow', async () => {
    // 2000 - 300 - (60*10) = 1100
    expect(await availableCash(USER, query)).toBe(1100);
  });
});

describe('sellableShares', () => {
  it('is the long position minus shares already committed to open sell orders', async () => {
    // 12 held - 4 resting sell = 8
    expect(await sellableShares(marketId, USER, query)).toBe(8);
  });
});
