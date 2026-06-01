import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uid } from './helpers.js';
const { query, pool, getClient } = require('../server/db');
const { createExchangeMarket } = require('../server/exchange/createMarket');
const { ensureBot, botUserId } = require('../server/exchange/botAccount');
const { placeOrder } = require('../server/exchange/executor');

const OWNER = uid('bot-owner');
let GROUP, marketId;

beforeAll(async () => {
  await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100000) ON CONFLICT (id) DO NOTHING`, [OWNER, `${OWNER}@t.internal`]);
  const g = await query(`INSERT INTO groups (name, owner_id) VALUES ('g',$1) RETURNING id`, [OWNER]);
  GROUP = g.rows[0].id;
  ({ marketId } = await createExchangeMarket({ groupId: GROUP, creatorId: OWNER, title: 'bot acct test' }, query));
});
afterAll(async () => { await pool.end(); });

describe('ensureBot', () => {
  it('creates the per-market bot user idempotently', async () => {
    const id1 = await ensureBot(marketId, query);
    const id2 = await ensureBot(marketId, query);
    expect(id1).toBe(botUserId(marketId));
    expect(id2).toBe(id1);
    const { rows } = await query(`SELECT id FROM users WHERE id=$1`, [botUserId(marketId)]);
    expect(rows.length).toBe(1);
  });
});

describe('placeOrder allowShort', () => {
  it('lets the bot sell with no inventory (opens a short) when allowShort is set', async () => {
    const bot = await ensureBot(marketId, query);
    const res = await placeOrder({ marketId, userId: bot, side: 'sell', price: 55, qty: 10, type: 'limit', allowShort: true }, { getClient });
    expect(res.status).toBe('ok');
    const { rows } = await query(`SELECT shares FROM positions WHERE market_id=$1 AND user_id=$2`, [marketId, bot]);
    expect(rows.length === 0 || rows[0].shares === 0).toBe(true);
  });

  it('still rejects a normal user selling with no inventory (allowShort defaults false)', async () => {
    const u = uid('bot-human');
    await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100000) ON CONFLICT (id) DO NOTHING`, [u, `${u}@t.internal`]);
    const res = await placeOrder({ marketId, userId: u, side: 'sell', price: 55, qty: 10, type: 'limit' }, { getClient });
    expect(res.status).toBe('error');
    expect(res.error).toBe('short_not_allowed');
  });
});
