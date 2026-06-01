import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uid } from './helpers.js';
const { query, pool, getClient } = require('../server/db');
const { createExchangeMarket } = require('../server/exchange/createMarket');
const { ensureBot, botUserId } = require('../server/exchange/botAccount');
const { requoteBot } = require('../server/exchange/botDriver');

const OWNER = uid('cea-owner');
let GROUP;
beforeAll(async () => {
  await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100000) ON CONFLICT (id) DO NOTHING`, [OWNER, `${OWNER}@t.internal`]);
  const g = await query(`INSERT INTO groups (name, owner_id) VALUES ('g',$1) RETURNING id`, [OWNER]);
  GROUP = g.rows[0].id;
});
afterAll(async () => { await pool.end(); });

describe('exchange market creation flow', () => {
  it('creates an exchange market with config, insurance, and seeded two-sided bot liquidity', async () => {
    const { marketId } = await createExchangeMarket({ groupId: GROUP, creatorId: OWNER, title: 'flow test', seedPrice: 50 }, query);
    await ensureBot(marketId, query);
    await requoteBot(marketId, { getClient, query });

    const { rows: m } = await query(`SELECT mechanism FROM markets WHERE id=$1`, [marketId]);
    expect(m[0].mechanism).toBe('exchange');
    const { rows: ins } = await query(`SELECT balance FROM insurance_pool WHERE market_id=$1`, [marketId]);
    expect(ins.length).toBe(1);
    const bot = botUserId(marketId);
    const { rows: ord } = await query(
      `SELECT side, COUNT(*)::int n FROM orders WHERE market_id=$1 AND user_id=$2 AND status IN ('open','partial') GROUP BY side`, [marketId, bot]);
    const bySide = Object.fromEntries(ord.map((r) => [r.side, r.n]));
    expect(bySide.buy).toBeGreaterThan(0);
    expect(bySide.sell).toBeGreaterThan(0);
  });
});
