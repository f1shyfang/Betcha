import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uid } from './helpers.js';
const { query, pool, getClient } = require('../server/db');
const { createExchangeMarket } = require('../server/exchange/createMarket');
const { ensureBot } = require('../server/exchange/botAccount');
const { requoteBot } = require('../server/exchange/botDriver');
const { placeOrder } = require('../server/exchange/executor');
const { getMarketHistory } = require('../server/exchange/marketHistory');

const OWNER = uid('hist-owner');
let GROUP, marketId;
const deps = { getClient, query };

beforeAll(async () => {
  await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100000) ON CONFLICT (id) DO NOTHING`, [OWNER, `${OWNER}@t.internal`]);
  const g = await query(`INSERT INTO groups (name, owner_id) VALUES ('g',$1) RETURNING id`, [OWNER]);
  GROUP = g.rows[0].id;
  ({ marketId } = await createExchangeMarket({ groupId: GROUP, creatorId: OWNER, title: 'history test', seedPrice: 50 }, query));
  await ensureBot(marketId, query);
  await requoteBot(marketId, deps);                 // bot posts a ladder
  await placeOrder({ marketId, userId: OWNER, side: 'buy', price: 99, qty: 5, type: 'limit' }, deps); // crosses bot asks -> a trade w/ bot
  await requoteBot(marketId, deps);                 // cancels old ladder -> cancelled bot orders remain in table
});
afterAll(async () => { await pool.end(); });

describe('getMarketHistory', () => {
  it('returns price series, a bot bid/ask band, and bot trade markers', async () => {
    const h = await getMarketHistory(marketId, query);
    expect(Array.isArray(h.prices)).toBe(true);
    expect(h.prices.length).toBeGreaterThanOrEqual(1);
    expect(typeof h.prices[0].price).toBe('number');
    expect(Array.isArray(h.botBand)).toBe(true);
    expect(h.botBand.length).toBeGreaterThanOrEqual(1);
    const band = h.botBand.find((b) => b.bid != null && b.ask != null);
    expect(band.bid).toBeLessThan(band.ask);
    expect(Array.isArray(h.botMarkers)).toBe(true);
    expect(h.botMarkers.length).toBeGreaterThanOrEqual(1);
    expect(['buy', 'sell']).toContain(h.botMarkers[0].side);
  });
});
