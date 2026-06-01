import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uid } from './helpers.js';
const { query, pool, getClient } = require('../server/db');
const { createExchangeMarket } = require('../server/exchange/createMarket');
const { placeOrder } = require('../server/exchange/executor');
const { availableCash } = require('../server/exchange/accounts');

const SELLER = uid('ex-seller');
const BUYER = uid('ex-buyer');
let GROUP, marketId;

beforeAll(async () => {
  await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100000),($3,$4,100000) ON CONFLICT (id) DO NOTHING`,
    [SELLER, `${SELLER}@t.internal`, BUYER, `${BUYER}@t.internal`]);
  const g = await query(`INSERT INTO groups (name, owner_id) VALUES ('g',$1) RETURNING id`, [SELLER]);
  GROUP = g.rows[0].id;
  ({ marketId } = await createExchangeMarket({ groupId: GROUP, creatorId: SELLER, title: 'executor test' }, query));
  // Give SELLER a long inventory of 100 shares @ avg 50 so they can sell without shorting.
  await query(`INSERT INTO positions (market_id, user_id, shares, avg_entry) VALUES ($1,$2,100,50)`, [marketId, SELLER]);
});
afterAll(async () => { await pool.end(); });

const deps = { getClient };

describe('placeOrder', () => {
  it('rests a limit sell when nothing crosses it', async () => {
    const res = await placeOrder({ marketId, userId: SELLER, side: 'sell', price: 63, qty: 10, type: 'limit' }, deps);
    expect(res.status).toBe('ok');
    expect(res.filledQty).toBe(0);
    expect(res.residualQty).toBe(10);
  });

  it('crosses a marketable buy against the resting sell and fills at the maker price', async () => {
    const before = await availableCash(BUYER, query);
    const res = await placeOrder({ marketId, userId: BUYER, side: 'buy', price: 63, qty: 4, type: 'limit' }, deps);
    expect(res.status).toBe('ok');
    expect(res.filledQty).toBe(4);
    // Margin model lev=1: margin = ceil(63*4/1) = 252, same as old cash premium
    expect(await availableCash(BUYER, query)).toBe(before - 252);
    const { rows } = await query(`SELECT shares, avg_entry FROM positions WHERE market_id=$1 AND user_id=$2`, [marketId, BUYER]);
    expect(rows[0].shares).toBe(4);
    expect(Number(rows[0].avg_entry)).toBe(63);
    const { rows: s } = await query(`SELECT shares FROM positions WHERE market_id=$1 AND user_id=$2`, [marketId, SELLER]);
    expect(s[0].shares).toBe(96);
  });

  it('allows a human to open a short (no inventory required) when sufficient margin is available', async () => {
    // Human sells 10@60 with no inventory — opens a short position.
    // Margin required = ceil((100-60)*10/1) = 400; user has 100000 starting cash.
    const shortSeller = uid('ex-short');
    await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100000) ON CONFLICT (id) DO NOTHING`,
      [shortSeller, `${shortSeller}@t.internal`]);
    const res = await placeOrder({ marketId, userId: shortSeller, side: 'sell', price: 10, qty: 10, type: 'limit' }, deps);
    expect(res.status).toBe('ok');
  });

  it('rejects a buy that exceeds available margin', async () => {
    const poor = uid('ex-poor');
    await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100) ON CONFLICT (id) DO NOTHING`, [poor, `${poor}@t.internal`]);
    const res = await placeOrder({ marketId, userId: poor, side: 'buy', price: 90, qty: 50, type: 'limit' }, deps);
    expect(res.status).toBe('error');
    expect(res.error).toBe('insufficient_margin');
  });

  it('rejects market orders in Plan 2', async () => {
    const res = await placeOrder({ marketId, userId: BUYER, side: 'buy', price: null, qty: 1, type: 'market' }, deps);
    expect(res.status).toBe('error');
    expect(res.error).toBe('market_orders_plan3');
  });

  it('leveraged long locks less margin — ceil(maxLoss/leverage)', async () => {
    // Create a fresh market with a bot ask so we can fill immediately.
    const botUser = uid('ex-lev-bot');
    const levUser = uid('ex-lev-user');
    await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100000),($3,$4,100000) ON CONFLICT (id) DO NOTHING`,
      [botUser, `${botUser}@t.internal`, levUser, `${levUser}@t.internal`]);
    const levG = await query(`INSERT INTO groups (name, owner_id) VALUES ('lev-g',$1) RETURNING id`, [botUser]);
    const { marketId: levMktId } = await createExchangeMarket(
      { groupId: levG.rows[0].id, creatorId: botUser, title: 'leverage test' }, query
    );
    // Bot rests a sell@50 with allowShort so levUser can buy against it.
    await placeOrder({ marketId: levMktId, userId: botUser, side: 'sell', price: 50, qty: 10, type: 'limit', allowShort: true }, deps);
    const before = await availableCash(levUser, query);
    // levUser buys 10@50 with leverage=5: margin = ceil(50*10/5) = 100
    const res = await placeOrder({ marketId: levMktId, userId: levUser, side: 'buy', price: 50, qty: 10, type: 'limit', leverage: 5 }, deps);
    expect(res.status).toBe('ok');
    expect(res.filledQty).toBe(10);
    const after = await availableCash(levUser, query);
    expect(after).toBe(before - 100); // ceil(50*10/5) = 100
    const { rows } = await query(`SELECT shares FROM positions WHERE market_id=$1 AND user_id=$2`, [levMktId, levUser]);
    expect(rows[0].shares).toBe(10);
  });

  // --- Regression: reduce with different leverage falsely rejected (bug #1) ---
  it('reduce order with lower leverage is accepted even with little spare cash', async () => {
    // Seed a user who is long 10@50 at leverage 5.  Their margin_posted is 100
    // (ceil(50*10/5)=100).  We give them starting_points=150 so free cash is
    // only 50 after the position margin is subtracted.
    // A sell of 5 at price 70 (above any likely book bid so it rests) is a
    // pure reduce.  With the bug the pre-check computes marginAfter using the
    // order's leverage (1), which gives ceil(70*5/1)=350 for the hypothetical
    // SHORT that would result if executed, versus the prior marginBefore=100,
    // a delta of +250 — wrongly failing the cash check.
    // With the fix, effectiveLeverage sees a reduce → keeps lev=5, so
    // marginAfter = ceil(50*5/5)=50, delta = 50-100 = -50 (<= 0) → no cash check.
    const reduceUser = uid('ex-reduce');
    await query(
      `INSERT INTO users (id, email, starting_points) VALUES ($1,$2,150) ON CONFLICT (id) DO NOTHING`,
      [reduceUser, `${reduceUser}@t.internal`]
    );
    // Seed position: long 10@50 leverage 5, margin_posted=100
    await query(
      `INSERT INTO positions (market_id, user_id, shares, avg_entry, leverage, margin_posted)
       VALUES ($1,$2,10,50,5,100)
       ON CONFLICT (market_id, user_id) DO UPDATE SET shares=10, avg_entry=50, leverage=5, margin_posted=100`,
      [marketId, reduceUser]
    );
    // Place a resting sell (reduce) at 70 — well above any best bid, so it rests.
    // Use leverage=1 (the order's leverage), which used to trigger the false rejection.
    const res = await placeOrder(
      { marketId, userId: reduceUser, side: 'sell', price: 70, qty: 5, type: 'limit', leverage: 1 },
      deps
    );
    expect(res.status).toBe('ok');
  });

  // --- Regression: flip long→short stores wrong leverage (bug #2) ---
  it('flip long→short stores the order leverage, not the prior leverage', async () => {
    // We set up: flipUser is long 10@60 at leverage 3, stored in DB.
    // A bot rests bids at 60 so the flipUser SELL 15@60 will cross and fill
    // 10 immediately (net position goes to -5, leverage should be 2=order's).
    const flipUser = uid('ex-flip');
    const flipBot = uid('ex-flip-bot');
    await query(
      `INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100000),($3,$4,100000)
       ON CONFLICT (id) DO NOTHING`,
      [flipUser, `${flipUser}@t.internal`, flipBot, `${flipBot}@t.internal`]
    );
    // Dedicated market for this test.
    const { marketId: flipMktId } = await createExchangeMarket(
      { groupId: GROUP, creatorId: flipUser, title: 'flip leverage test' }, query
    );
    // Seed flipUser position: long 10@60 at leverage 3, margin_posted = ceil(60*10/3)=200
    await query(
      `INSERT INTO positions (market_id, user_id, shares, avg_entry, leverage, margin_posted)
       VALUES ($1,$2,10,60,3,200)
       ON CONFLICT (market_id, user_id) DO UPDATE SET shares=10, avg_entry=60, leverage=3, margin_posted=200`,
      [flipMktId, flipUser]
    );
    // Bot rests a bid at 60 (allowShort so it can provide the other side).
    await placeOrder(
      { marketId: flipMktId, userId: flipBot, side: 'buy', price: 60, qty: 15, type: 'limit', allowShort: true },
      deps
    );
    // flipUser sells 15@60 with leverage=2.  10 fills immediately (crosses bot bid),
    // residual 5 rests as a short (or all 15 fill if bot had 15 qty).
    // After fill: net = 10 - 15 = -5 (short 5).  Effective leverage should be 2.
    const res = await placeOrder(
      { marketId: flipMktId, userId: flipUser, side: 'sell', price: 60, qty: 15, type: 'limit', leverage: 2 },
      deps
    );
    expect(res.status).toBe('ok');
    expect(res.filledQty).toBeGreaterThan(0); // at least some fill happened

    const { rows } = await query(
      `SELECT shares, leverage FROM positions WHERE market_id=$1 AND user_id=$2`,
      [flipMktId, flipUser]
    );
    expect(rows.length).toBe(1);
    // Position must be short (or flat if bot only had enough for 10 — still net
    // the remaining sell should be stored).  The key assertion: whenever the
    // position is short (shares < 0) the leverage stored must be 2 (order's),
    // not 3 (prior position's).
    if (Number(rows[0].shares) < 0) {
      expect(Number(rows[0].leverage)).toBe(2);
    }
    // Also verify the helper directly (unit coverage even if the fill is partial).
    const { effectiveLeverage } = require('../server/exchange/executor');
    expect(effectiveLeverage(10, 3, -5, 2)).toBe(2);
  });

  it('handles a self-trade without corrupting the position (taker and maker are the same user)', async () => {
    const self = uid('ex-self');
    await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100000) ON CONFLICT (id) DO NOTHING`, [self, `${self}@t.internal`]);
    // Use a dedicated market so no existing orders interfere with the self-cross.
    const { marketId: selfMarketId } = await createExchangeMarket(
      { groupId: GROUP, creatorId: self, title: 'self-trade test' }, query
    );
    // Give the user 50 shares so they can later sell, and enough cash to buy.
    await query(
      `INSERT INTO positions (market_id, user_id, shares, avg_entry) VALUES ($1,$2,50,40)
       ON CONFLICT (market_id,user_id) DO UPDATE SET shares=50, avg_entry=40`,
      [selfMarketId, self]
    );
    // Rest a buy at 55. In a fresh, empty book this will not cross anything.
    await placeOrder({ marketId: selfMarketId, userId: self, side: 'buy', price: 55, qty: 10, type: 'limit' }, deps);
    // Snapshot shares AFTER resting the buy (buy doesn't change shares, only reserves cash).
    const { rows: beforeRows } = await query(
      `SELECT shares FROM positions WHERE market_id=$1 AND user_id=$2`,
      [selfMarketId, self]
    );
    const sharesBefore = beforeRows[0].shares;
    // Now place a marketable sell at 55 — it crosses the user's own resting buy.
    const res = await placeOrder({ marketId: selfMarketId, userId: self, side: 'sell', price: 55, qty: 10, type: 'limit' }, deps);
    expect(res.status).toBe('ok');
    const { rows: afterRows } = await query(
      `SELECT shares FROM positions WHERE market_id=$1 AND user_id=$2`,
      [selfMarketId, self]
    );
    // Self-cross is a wash: the buy (+10) and the sell (-10) net to zero.
    expect(afterRows[0].shares).toBe(sharesBefore);
  });
});
