import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uid } from './helpers.js';
const { query, pool, getClient } = require('../server/db');
const { createExchangeMarket } = require('../server/exchange/createMarket');
const { ensureBot, botUserId } = require('../server/exchange/botAccount');
const { requoteBot } = require('../server/exchange/botDriver');

const OWNER = uid('bd-owner');
let GROUP, marketId;
const deps = { getClient, query };

beforeAll(async () => {
  await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100000) ON CONFLICT (id) DO NOTHING`, [OWNER, `${OWNER}@t.internal`]);
  const g = await query(`INSERT INTO groups (name, owner_id) VALUES ('g',$1) RETURNING id`, [OWNER]);
  GROUP = g.rows[0].id;
  ({ marketId } = await createExchangeMarket({ groupId: GROUP, creatorId: OWNER, title: 'bot driver test', seedPrice: 50 }, query));
  await ensureBot(marketId, query);
});
afterAll(async () => { await pool.end(); });

describe('requoteBot', () => {
  it('posts a two-sided ladder of bot orders around the seed price', async () => {
    await requoteBot(marketId, deps);
    const bot = botUserId(marketId);
    const { rows } = await query(
      `SELECT side, COUNT(*)::int AS n FROM orders WHERE market_id=$1 AND user_id=$2 AND status IN ('open','partial') GROUP BY side`,
      [marketId, bot]
    );
    const bySide = Object.fromEntries(rows.map((r) => [r.side, r.n]));
    expect(bySide.buy).toBeGreaterThan(0);
    expect(bySide.sell).toBeGreaterThan(0);
  });

  it('cancels the previous ladder when re-quoting (no unbounded order growth)', async () => {
    const bot = botUserId(marketId);
    await requoteBot(marketId, deps);
    await requoteBot(marketId, deps);
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM orders WHERE market_id=$1 AND user_id=$2 AND status IN ('open','partial')`,
      [marketId, bot]
    );
    expect(rows[0].n).toBeLessThanOrEqual(10);
  });
});
