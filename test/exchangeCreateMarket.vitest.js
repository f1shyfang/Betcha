import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uid } from './helpers.js';
const { query, pool } = require('../server/db');
const { createExchangeMarket } = require('../server/exchange/createMarket');

const USER = uid('xc-user');
let GROUP;

beforeAll(async () => {
  await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,2000) ON CONFLICT (id) DO NOTHING`, [USER, `${USER}@t.internal`]);
  const { rows: g } = await query(`INSERT INTO groups (name, owner_id) VALUES ('xc-group',$1) RETURNING id`, [USER]);
  GROUP = g[0].id;
});
afterAll(async () => { await pool.end(); });

describe('createExchangeMarket', () => {
  it('creates a market with mechanism=exchange and an exchange config row', async () => {
    const { marketId } = await createExchangeMarket(
      { groupId: GROUP, creatorId: USER, title: 'Will it ship?', seedPrice: 40 },
      query
    );
    const { rows: m } = await query(`SELECT mechanism FROM markets WHERE id=$1`, [marketId]);
    expect(m[0].mechanism).toBe('exchange');
    const { rows: c } = await query(`SELECT seed_price, max_leverage FROM market_exchange_config WHERE market_id=$1`, [marketId]);
    expect(c[0].seed_price).toBe(40);
    expect(c[0].max_leverage).toBe(10);
  });

  it('defaults the seed price to 50 when omitted', async () => {
    const { marketId } = await createExchangeMarket({ groupId: GROUP, creatorId: USER, title: 'Coin flip?' }, query);
    const { rows: c } = await query(`SELECT seed_price FROM market_exchange_config WHERE market_id=$1`, [marketId]);
    expect(c[0].seed_price).toBe(50);
  });
});
