import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uid } from './helpers.js';
const { query, pool, getClient } = require('../server/db');
const { createExchangeMarket } = require('../server/exchange/createMarket');
const { ensureBot, botUserId } = require('../server/exchange/botAccount');
const { placeOrder } = require('../server/exchange/executor');

const OWNER = uid('set-owner');
const BUYER = uid('set-buyer');
let GROUP, marketId, bot;

beforeAll(async () => {
  await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100000),($3,$4,100000) ON CONFLICT (id) DO NOTHING`,
    [OWNER, `${OWNER}@t.internal`, BUYER, `${BUYER}@t.internal`]);
  const g = await query(`INSERT INTO groups (name, owner_id) VALUES ('g',$1) RETURNING id`, [OWNER]);
  GROUP = g.rows[0].id;
  ({ marketId } = await createExchangeMarket({ groupId: GROUP, creatorId: OWNER, title: 'settle test', seedPrice: 50 }, query));
  bot = await ensureBot(marketId, query);
  await placeOrder({ marketId, userId: bot, side: 'sell', price: 60, qty: 10, type: 'limit', allowShort: true }, { getClient });
  await placeOrder({ marketId, userId: BUYER, side: 'buy', price: 60, qty: 10, type: 'limit' }, { getClient });
});
afterAll(async () => { await pool.end(); });

describe('market_resolve_exchange', () => {
  it('books terminal payouts that are zero-sum and resolves the market (YES)', async () => {
    await query(`SELECT market_resolve_exchange($1,$2,$3,$4,$5)`, [marketId, OWNER, true, 'creator', '']);

    const { rows: st } = await query(`SELECT state FROM markets WHERE id=$1`, [marketId]);
    expect(st[0].state).toBe('resolved');

    const { rows: buyerSettle } = await query(
      `SELECT COALESCE(SUM(delta),0)::int AS d FROM ledger_entries WHERE market_id=$1 AND user_id=$2 AND reason='settlement'`, [marketId, BUYER]);
    const { rows: botSettle } = await query(
      `SELECT COALESCE(SUM(delta),0)::int AS d FROM ledger_entries WHERE market_id=$1 AND user_id=$2 AND reason='settlement'`, [marketId, bot]);
    expect(buyerSettle[0].d).toBe(1000);
    expect(botSettle[0].d).toBe(-1000);

    const { rows: total } = await query(
      `SELECT COALESCE(SUM(delta),0)::int AS d FROM ledger_entries WHERE market_id=$1 AND reason='settlement'`, [marketId]);
    expect(total[0].d).toBe(0);
  });
});
