import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uid } from './helpers.js';
const { query, pool, getClient } = require('../server/db');
const { createExchangeMarket } = require('../server/exchange/createMarket');
const { ensureBot } = require('../server/exchange/botAccount');
const { requoteBot } = require('../server/exchange/botDriver');
const { availableCash } = require('../server/exchange/accounts');
const { runLiquidations } = require('../server/exchange/liquidationDriver');
const { positionMargin } = require('../server/exchange/positionMargin');

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

describe('runLiquidations', () => {
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
});
