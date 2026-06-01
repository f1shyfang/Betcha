import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uid } from './helpers.js';
const { query, pool, getClient } = require('../server/db');
const { createExchangeMarket } = require('../server/exchange/createMarket');
const { ensureBot } = require('../server/exchange/botAccount');
const { requoteBot } = require('../server/exchange/botDriver');
const { availableCash } = require('../server/exchange/accounts');
const { runLiquidations } = require('../server/exchange/liquidationDriver');
const { positionMargin } = require('../server/exchange/positionMargin');

// ─────────────────────────────────────────────────────────────────────────────
// GAP-PATH SUITE
// Forced sell at cap=81 never fills (bot bids ~48, no bid ≥ cap) → residual
// covered by insurance pool. After Bug 1 fix, no resting order must remain.
// ─────────────────────────────────────────────────────────────────────────────

const OWNER = uid('liqd-owner');
const TRADER = uid('liqd-trader');
let GROUP, marketId;
const deps = { getClient, query };

beforeAll(async () => {
  // Create users
  await query(
    `INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100000),($3,$4,100000) ON CONFLICT (id) DO NOTHING`,
    [OWNER, `${OWNER}@t.internal`, TRADER, `${TRADER}@t.internal`]
  );

  // Create group
  const g = await query(
    `INSERT INTO groups (name, owner_id) VALUES ('liqd-group',$1) RETURNING id`,
    [OWNER]
  );
  GROUP = g.rows[0].id;

  // Create exchange market with seedPrice=50, max_leverage=10 (default from migration 012)
  ({ marketId } = await createExchangeMarket(
    { groupId: GROUP, creatorId: OWNER, title: 'liquidation driver test', seedPrice: 50 },
    query
  ));

  // Seed insurance pool so residual-cover path has funds
  await query(
    `INSERT INTO insurance_pool (market_id, balance) VALUES ($1, 100000)
     ON CONFLICT (market_id) DO UPDATE SET balance = 100000`,
    [marketId]
  );

  // Spin up bot and quote a two-sided ladder around 50
  await ensureBot(marketId, query);
  await requoteBot(marketId, deps);

  // Seed TRADER position: long 20 shares @ avg_entry=90, leverage=10.
  // This is already deeply underwater vs the mark (~50).
  // mustLiquidate check: bp = 90*(1-1/10) = 81, liqPrice = 81+3 = 84.
  // mark ≈ 50 << 84  →  mustLiquidate = true deterministically.
  // Forced sell cap = floor(81) = 81. Bot best bid ≈ 48 (seedPrice 50, half-spread 2).
  // No bid ≥ 81 → order rests open → residual-cover path runs.
  // margin_posted = ceil(90 * 20 / 10) = 180
  const marginPosted = positionMargin({ shares: 20, avgEntry: 90, leverage: 10 });
  await query(
    `INSERT INTO positions (market_id, user_id, shares, avg_entry, leverage, margin_posted)
     VALUES ($1,$2,20,90,10,$3)
     ON CONFLICT (market_id, user_id) DO UPDATE
       SET shares=20, avg_entry=90, leverage=10, margin_posted=$3`,
    [marketId, TRADER, marginPosted]
  );
}, 30000);

afterAll(async () => {
  await pool.end();
});

describe('runLiquidations (gap path: bot bids ~48, cap=81, no fill → residual cover)', () => {
  it('closes the breached long position and returns the user in the liquidated list', async () => {
    const result = await runLiquidations(marketId, deps);

    // TRADER must appear in the liquidated list
    expect(result.liquidated).toContain(TRADER);
  });

  it('TRADER position shares === 0 after liquidation (fully closed)', async () => {
    const { rows } = await query(
      `SELECT shares FROM positions WHERE market_id=$1 AND user_id=$2`,
      [marketId, TRADER]
    );
    // Either the row is gone or shares is 0
    const shares = rows.length === 0 ? 0 : Number(rows[0].shares);
    expect(shares).toBe(0);
  });

  it('TRADER available cash >= 0 after liquidation (solvency guarantee)', async () => {
    const cash = await availableCash(TRADER, query);
    expect(cash).toBeGreaterThanOrEqual(0);
  });

  it('does not liquidate the bot account', async () => {
    const result = await runLiquidations(marketId, deps);
    const botId = `bot:${marketId}`;
    expect(result.liquidated).not.toContain(botId);
  });

  it('returns empty liquidated list when no positions breach (idempotent after close)', async () => {
    // TRADER is already closed; calling again should find nothing to liquidate
    const result = await runLiquidations(marketId, deps);
    expect(result.liquidated).toHaveLength(0);
  });

  it('Bug 1: no resting forced-close order left after gap liquidation (orphan-order fix)', async () => {
    // After residual-cover path runs, the forced-close limit order that failed
    // to fill must have been cancelled — not left as 'open' or 'partial'.
    const { rows } = await query(
      `SELECT id, status FROM orders WHERE market_id=$1 AND user_id=$2 AND status IN ('open','partial')`,
      [marketId, TRADER]
    );
    expect(rows).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FILL-PATH SUITE
// seedPrice=83 → bot best bid ≈ 81 (half-spread=2). TRADER long 20@90 lev=10:
//   bp=81, liqPrice=84, mark≈83 < 84 → breaches.
//   Forced sell cap=81, bot bid=81 ≥ cap → REAL FILL against the bot.
// ─────────────────────────────────────────────────────────────────────────────

const OWNER2 = uid('liqf-owner');
const TRADER2 = uid('liqf-trader');
let GROUP2, marketId2;
const deps2 = { getClient, query };

beforeAll(async () => {
  await query(
    `INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100000),($3,$4,100000) ON CONFLICT (id) DO NOTHING`,
    [OWNER2, `${OWNER2}@t.internal`, TRADER2, `${TRADER2}@t.internal`]
  );

  const g2 = await query(
    `INSERT INTO groups (name, owner_id) VALUES ('liqf-group',$1) RETURNING id`,
    [OWNER2]
  );
  GROUP2 = g2.rows[0].id;

  // seedPrice=83: bot fair=83, best bid = clamp(83-2-0)=81, best ask=85.
  ({ marketId: marketId2 } = await createExchangeMarket(
    { groupId: GROUP2, creatorId: OWNER2, title: 'liquidation fill-path test', seedPrice: 83 },
    query
  ));

  await query(
    `INSERT INTO insurance_pool (market_id, balance) VALUES ($1, 100000)
     ON CONFLICT (market_id) DO UPDATE SET balance = 100000`,
    [marketId2]
  );

  await ensureBot(marketId2, query);
  await requoteBot(marketId2, deps2);

  // Confirm bot's best bid empirically before seeding the position
  const { rows: botBids } = await query(
    `SELECT price FROM orders WHERE market_id=$1 AND side='buy' AND status IN ('open','partial')
     ORDER BY price DESC LIMIT 3`,
    [marketId2]
  );
  // The best bid should be 81; log it for visibility
  console.log('[fill-path] bot best bids after requote:', botBids.map((r) => Number(r.price)));

  // TRADER2 long: shares=20, avg_entry=90, leverage=10
  //   bp = 90*(1-1/10) = 81  →  cap = floor(81) = 81
  //   liqPrice = 81 + 3 = 84  →  mark 83 < 84 → breaches
  //   Bot best bid = 81 ≥ cap=81 → forced sell at 81 fills
  const margin2 = positionMargin({ shares: 20, avgEntry: 90, leverage: 10 });
  await query(
    `INSERT INTO positions (market_id, user_id, shares, avg_entry, leverage, margin_posted)
     VALUES ($1,$2,20,90,10,$3)
     ON CONFLICT (market_id, user_id) DO UPDATE
       SET shares=20, avg_entry=90, leverage=10, margin_posted=$3`,
    [marketId2, TRADER2, margin2]
  );
}, 30000);

describe('runLiquidations (fill path: bot bid=81 ≥ cap=81 → real fill)', () => {
  let fillResult;

  it('runLiquidations returns TRADER2 in liquidated list', async () => {
    fillResult = await runLiquidations(marketId2, deps2);
    expect(fillResult.liquidated).toContain(TRADER2);
  });

  it('a trades row exists for the market with taker_user = TRADER2 (real fill happened)', async () => {
    const { rows } = await query(
      `SELECT id FROM trades WHERE market_id=$1 AND taker_user=$2`,
      [marketId2, TRADER2]
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('TRADER2 position shares === 0 after fill', async () => {
    const { rows } = await query(
      `SELECT shares FROM positions WHERE market_id=$1 AND user_id=$2`,
      [marketId2, TRADER2]
    );
    const shares = rows.length === 0 ? 0 : Number(rows[0].shares);
    expect(shares).toBe(0);
  });

  it('a realized_pnl ledger entry exists for TRADER2 (fill booked P&L)', async () => {
    const { rows } = await query(
      `SELECT delta FROM ledger_entries WHERE user_id=$1 AND market_id=$2 AND reason='realized_pnl'`,
      [TRADER2, marketId2]
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('TRADER2 available cash >= 0 after fill (solvency guarantee)', async () => {
    const cash = await availableCash(TRADER2, query);
    expect(cash).toBeGreaterThanOrEqual(0);
  });
});
