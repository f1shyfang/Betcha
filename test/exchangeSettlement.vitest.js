import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uid } from './helpers.js';
const { query, pool, getClient } = require('../server/db');
const { createExchangeMarket } = require('../server/exchange/createMarket');
const { ensureBot } = require('../server/exchange/botAccount');
const { placeOrder } = require('../server/exchange/executor');

const OWNER = uid('set-owner');
const BUYER = uid('set-buyer');
let GROUP, marketId, bot;

// Separate owner/buyer for the NO-outcome market
const OWNER2 = uid('set-owner2');
const BUYER2 = uid('set-buyer2');
let marketIdNo, bot2;

beforeAll(async () => {
  await query(
    `INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100000),($3,$4,100000),($5,$6,100000),($7,$8,100000) ON CONFLICT (id) DO NOTHING`,
    [OWNER, `${OWNER}@t.internal`, BUYER, `${BUYER}@t.internal`,
     OWNER2, `${OWNER2}@t.internal`, BUYER2, `${BUYER2}@t.internal`]
  );
  const g = await query(`INSERT INTO groups (name, owner_id) VALUES ('g',$1) RETURNING id`, [OWNER]);
  GROUP = g.rows[0].id;

  // YES market setup
  ({ marketId } = await createExchangeMarket({ groupId: GROUP, creatorId: OWNER, title: 'settle test', seedPrice: 50 }, query));
  bot = await ensureBot(marketId, query);
  await placeOrder({ marketId, userId: bot, side: 'sell', price: 60, qty: 10, type: 'limit', allowShort: true }, { getClient });
  await placeOrder({ marketId, userId: BUYER, side: 'buy', price: 60, qty: 10, type: 'limit' }, { getClient });

  // NO market setup
  const g2 = await query(`INSERT INTO groups (name, owner_id) VALUES ('g2',$1) RETURNING id`, [OWNER2]);
  const noMarket = await createExchangeMarket({ groupId: g2.rows[0].id, creatorId: OWNER2, title: 'settle test NO', seedPrice: 50 }, query);
  marketIdNo = noMarket.marketId;
  bot2 = await ensureBot(marketIdNo, query);
  await placeOrder({ marketId: marketIdNo, userId: bot2, side: 'sell', price: 60, qty: 10, type: 'limit', allowShort: true }, { getClient });
  await placeOrder({ marketId: marketIdNo, userId: BUYER2, side: 'buy', price: 60, qty: 10, type: 'limit' }, { getClient });
});
afterAll(async () => { await pool.end(); });

describe('market_resolve_exchange', () => {
  it('books terminal payouts that are zero-sum and resolves the market (YES)', async () => {
    await query(`SELECT market_resolve_exchange($1,$2,$3,$4,$5)`, [marketId, OWNER, true, 'creator', '']);

    const { rows: st } = await query(`SELECT state FROM markets WHERE id=$1`, [marketId]);
    expect(st[0].state).toBe('resolved');

    // Margin model: P&L = (terminal - avg_entry) * shares
    // BUYER long 10@60, YES (terminal=100): (100-60)*10 = +400
    // Bot short -10@60, YES (terminal=100): (100-60)*(-10) = -400
    const { rows: buyerSettle } = await query(
      `SELECT COALESCE(SUM(delta),0)::int AS d FROM ledger_entries WHERE market_id=$1 AND user_id=$2 AND reason='settlement'`, [marketId, BUYER]);
    const { rows: botSettle } = await query(
      `SELECT COALESCE(SUM(delta),0)::int AS d FROM ledger_entries WHERE market_id=$1 AND user_id=$2 AND reason='settlement'`, [marketId, bot]);
    expect(buyerSettle[0].d).toBe(400);
    expect(botSettle[0].d).toBe(-400);

    const { rows: total } = await query(
      `SELECT COALESCE(SUM(delta),0)::int AS d FROM ledger_entries WHERE market_id=$1 AND reason='settlement'`, [marketId]);
    expect(total[0].d).toBe(0);

    // Idempotency: calling resolve a SECOND time must not double-settle.
    await query(`SELECT market_resolve_exchange($1,$2,$3,$4,$5)`, [marketId, OWNER, true, 'creator', '']);

    const { rows: buyerAfterRetry } = await query(
      `SELECT COALESCE(SUM(delta),0)::int AS d FROM ledger_entries WHERE market_id=$1 AND user_id=$2 AND reason='settlement'`, [marketId, BUYER]);
    expect(buyerAfterRetry[0].d).toBe(400); // must still be 400, NOT 800

    const { rows: totalAfterRetry } = await query(
      `SELECT COALESCE(SUM(delta),0)::int AS d FROM ledger_entries WHERE market_id=$1 AND reason='settlement'`, [marketId]);
    expect(totalAfterRetry[0].d).toBe(0); // market-wide settlement total still 0
  });

  it('books non-zero settlement rows on NO outcome and the result is zero-sum', async () => {
    await query(`SELECT market_resolve_exchange($1,$2,$3,$4,$5)`, [marketIdNo, OWNER2, false, 'creator', '']);

    const { rows: st } = await query(`SELECT state FROM markets WHERE id=$1`, [marketIdNo]);
    expect(st[0].state).toBe('resolved');

    // Margin model: P&L = (terminal - avg_entry) * shares
    // BUYER2 long 10@60, NO (terminal=0): (0-60)*10 = -600
    // Bot2 short -10@60, NO (terminal=0): (0-60)*(-10) = +600
    const { rows: buyerSettle } = await query(
      `SELECT COALESCE(SUM(delta),0)::int AS d FROM ledger_entries WHERE market_id=$1 AND user_id=$2 AND reason='settlement'`, [marketIdNo, BUYER2]);
    const { rows: botSettle } = await query(
      `SELECT COALESCE(SUM(delta),0)::int AS d FROM ledger_entries WHERE market_id=$1 AND user_id=$2 AND reason='settlement'`, [marketIdNo, bot2]);
    expect(buyerSettle[0].d).toBe(-600);
    expect(botSettle[0].d).toBe(600);

    // Zero-sum: -600 + 600 = 0
    const { rows: total } = await query(
      `SELECT COALESCE(SUM(delta),0)::int AS d FROM ledger_entries WHERE market_id=$1 AND reason='settlement'`, [marketIdNo]);
    expect(total[0].d).toBe(0);

    // BUYER2's net ledger for the market: no buy_fill (margin model), just settlement -600
    const { rows: buyerNet } = await query(
      `SELECT COALESCE(SUM(delta),0)::int AS d FROM ledger_entries WHERE market_id=$1 AND user_id=$2`, [marketIdNo, BUYER2]);
    expect(buyerNet[0].d).toBe(-600);
  });
});
