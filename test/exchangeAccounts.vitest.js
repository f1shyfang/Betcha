import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uid } from './helpers.js';
const { query, pool } = require('../server/db');
const { createExchangeMarket } = require('../server/exchange/createMarket');
const { availableCash } = require('../server/exchange/accounts');

const USER = uid('ac2-user');
let GROUP, marketId;

beforeAll(async () => {
  await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,2000) ON CONFLICT (id) DO NOTHING`, [USER, `${USER}@t.internal`]);
  const g = await query(`INSERT INTO groups (name, owner_id) VALUES ('g',$1) RETURNING id`, [USER]);
  GROUP = g.rows[0].id;
  ({ marketId } = await createExchangeMarket({ groupId: GROUP, creatorId: USER, title: 'acct2 test' }, query));
  await query(`INSERT INTO ledger_entries (user_id, market_id, delta, reason) VALUES ($1,$2,-100,'realized_pnl')`, [USER, marketId]);
  await query(`INSERT INTO positions (market_id, user_id, shares, avg_entry, margin_posted, leverage) VALUES ($1,$2,5,50,250,1)`, [marketId, USER]);
  await query(`INSERT INTO orders (market_id, user_id, side, price, quantity, filled_quantity, leverage, status) VALUES ($1,$2,'buy',60,10,0,1,'open')`, [marketId, USER]);
  await query(`INSERT INTO orders (market_id, user_id, side, price, quantity, filled_quantity, leverage, status) VALUES ($1,$2,'sell',70,4,0,2,'open')`, [marketId, USER]);
});
afterAll(async () => { await pool.end(); });

describe('availableCash (margin model)', () => {
  it('= starting + ledger - position margin - open-order escrow', async () => {
    // 2000 - 100 - 250 - 600 - 60 = 990  (buy escrow ceil(60*10/1)=600; short escrow ceil((100-70)*4/2)=60)
    expect(await availableCash(USER, query)).toBe(990);
  });
});
