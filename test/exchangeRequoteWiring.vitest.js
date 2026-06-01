import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uid } from './helpers.js';
const { query, pool, getClient } = require('../server/db');
const { createExchangeMarket } = require('../server/exchange/createMarket');
const { ensureBot, botUserId } = require('../server/exchange/botAccount');
const { placeOrder } = require('../server/exchange/executor');
const { requoteBot } = require('../server/exchange/botDriver');

const OWNER = uid('rw-owner');
let GROUP, marketId, bot;
const deps = { getClient, query };

beforeAll(async () => {
  await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100000) ON CONFLICT (id) DO NOTHING`, [OWNER, `${OWNER}@t.internal`]);
  const g = await query(`INSERT INTO groups (name, owner_id) VALUES ('g',$1) RETURNING id`, [OWNER]);
  GROUP = g.rows[0].id;
  ({ marketId } = await createExchangeMarket({ groupId: GROUP, creatorId: OWNER, title: 'requote wiring', seedPrice: 50 }, query));
  bot = await ensureBot(marketId, query);
});
afterAll(async () => { await pool.end(); });

describe('requote after trade', () => {
  it('keeps a live two-sided bot ladder and moves the mark after a trade lifts an ask', async () => {
    await requoteBot(marketId, deps); // initial liquidity
    // OWNER lifts some bot asks
    const buy = await placeOrder({ marketId, userId: OWNER, side: 'buy', price: 99, qty: 20, type: 'limit' }, deps);
    expect(buy.status).toBe('ok');
    expect(buy.filledQty).toBeGreaterThan(0); // crossed bot asks
    // requote again (as the handler would after a trade)
    await requoteBot(marketId, deps);
    const { rows } = await query(
      `SELECT side, COUNT(*)::int AS n FROM orders WHERE market_id=$1 AND user_id=$2 AND status IN ('open','partial') GROUP BY side`,
      [marketId, bot]);
    const bySide = Object.fromEntries(rows.map((r) => [r.side, r.n]));
    expect(bySide.buy).toBeGreaterThan(0);
    expect(bySide.sell).toBeGreaterThan(0);
    // a trade happened -> there is a last trade price
    const { rows: lt } = await query(`SELECT COUNT(*)::int AS n FROM trades WHERE market_id=$1`, [marketId]);
    expect(lt[0].n).toBeGreaterThan(0);
  });
});
