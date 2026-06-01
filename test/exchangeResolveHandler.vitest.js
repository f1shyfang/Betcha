import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uid } from './helpers.js';
const { query, pool, getClient } = require('../server/db');
const { createExchangeMarket } = require('../server/exchange/createMarket');
const { ensureBot } = require('../server/exchange/botAccount');
const { placeOrder } = require('../server/exchange/executor');
const { handleResolve } = require('../server/resolveHandler');
const { getIdempotentResponse, storeIdempotentResponse } = require('../server/idempotency');

const OWNER = uid('rh-owner');
const BUYER = uid('rh-buyer');
let GROUP, marketId, bot;

beforeAll(async () => {
  // Create OWNER and BUYER users
  await query(
    `INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100000),($3,$4,100000) ON CONFLICT (id) DO NOTHING`,
    [OWNER, `${OWNER}@t.internal`, BUYER, `${BUYER}@t.internal`]
  );

  // Create group via RETURNING id; insert BOTH into group_members
  const g = await query(
    `INSERT INTO groups (name, owner_id) VALUES ('resolve-handler-test',$1) RETURNING id`,
    [OWNER]
  );
  GROUP = g.rows[0].id;

  await query(
    `INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'admin'),($1,$3,'member')`,
    [GROUP, OWNER, BUYER]
  );

  // Create exchange market with OWNER as creator
  ({ marketId } = await createExchangeMarket(
    { groupId: GROUP, creatorId: OWNER, title: 'resolve handler exchange test', seedPrice: 50 },
    query
  ));

  // Ensure bot market-maker
  bot = await ensureBot(marketId, query);

  // Bot shorts (sell allowShort) 10@60; OWNER buys 10@60 — OWNER is now long 10 shares
  await placeOrder(
    { marketId, userId: bot, side: 'sell', price: 60, qty: 10, type: 'limit', allowShort: true },
    { getClient }
  );
  await placeOrder(
    { marketId, userId: OWNER, side: 'buy', price: 60, qty: 10, type: 'limit' },
    { getClient }
  );
});

afterAll(async () => {
  await pool.end();
});

describe('handleResolve — exchange market path', () => {
  it('resolves an exchange market via market_resolve_exchange RPC', async () => {
    const idempKey = uid('idem');

    const result = await handleResolve({
      marketId,
      outcome: true,
      method: 'creator',
      reason: '',
      idempKey,
      getIdempotentResponse,
      storeIdempotentResponse,
      userId: OWNER,
    });

    // Handler must return 200
    expect(result.status).toBe(200);

    // Market must now be resolved
    const { rows: mRows } = await query(`SELECT state FROM markets WHERE id=$1`, [marketId]);
    expect(mRows[0].state).toBe('resolved');

    // OWNER bought 10 shares @ 60 → buy_fill = −600
    // OWNER holds 10 long shares → settlement (YES outcome, terminal=100) = +1000
    // my_delta = −600 + 1000 = +400
    expect(result.body.market_id).toBe(marketId);
    expect(result.body.outcome).toBe(true);
    expect(result.body.my_breakdown.settlement).toBe(1000);
    expect(result.body.my_breakdown.buy_fill).toBe(-600);
    expect(result.body.my_delta).toBe(400);
  });

  it('returns the same result on a second call (idempotency)', async () => {
    // Use a fresh idempKey that was stored in the previous test — but since
    // each test creates a fresh idempKey, simulate by calling again with a new key
    // on an already-resolved market: must get 409 from state check, NOT double-settle.
    const result2 = await handleResolve({
      marketId,
      outcome: true,
      method: 'creator',
      reason: '',
      idempKey: uid('idem-retry'),
      getIdempotentResponse,
      storeIdempotentResponse,
      userId: OWNER,
    });
    // Market is resolved → state !== 'open' → 409
    expect(result2.status).toBe(409);

    // Confirm settlement rows were NOT duplicated
    const { rows: settlementRows } = await query(
      `SELECT COUNT(*)::int AS n FROM ledger_entries WHERE market_id=$1 AND reason='settlement'`,
      [marketId]
    );
    // OWNER has +1000, bot has -1000 = 2 settlement rows (zero-sum)
    expect(settlementRows[0].n).toBe(2);
  });

  it('rejects a non-member resolver with 403', async () => {
    // Need a fresh open market for this check
    const g2 = await query(
      `INSERT INTO groups (name, owner_id) VALUES ('rh-auth-test',$1) RETURNING id`,
      [OWNER]
    );
    const g2Id = g2.rows[0].id;
    await query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'admin')`,
      [g2Id, OWNER]
    );
    const { marketId: m2 } = await createExchangeMarket(
      { groupId: g2Id, creatorId: OWNER, title: 'auth guard test', seedPrice: 50 },
      query
    );

    const outsider = uid('rh-outsider');
    await query(
      `INSERT INTO users (id, email) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`,
      [outsider, `${outsider}@t.internal`]
    );

    const result = await handleResolve({
      marketId: m2,
      outcome: true,
      method: 'creator',
      reason: '',
      idempKey: uid('idem-forbidden'),
      getIdempotentResponse,
      storeIdempotentResponse,
      userId: outsider,
    });
    expect(result.status).toBe(403);
  });
});
