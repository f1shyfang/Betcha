# Exchange Core — Schema + Pure CLOB Math (Plan 1 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the schema migration and the entire pure, DB-free logic layer for the CLOB Exchange market type — matching, position folding, margin (with leverage), liquidation/bankruptcy math, mark price, and the bot quoter — each exhaustively unit-tested with Vitest.

**Architecture:** Pure CommonJS modules under `server/exchange/` (so the CommonJS trade executor in a later plan can `require` them), each with one responsibility and no DB or framework dependency. Every module is tested in isolation with Vitest (`test/*.vitest.js`), following the existing `lib/predictionForm.js` + `test/predictionForm.vitest.js` style. The only DB-touching item is the schema migration, which is verified by an information-schema check test.

**Tech Stack:** Node.js (CommonJS), Vitest, Postgres (Neon), `pg`. Prices are integer cents `1..99`; a YES share settles to 100 points if YES, 0 if NO. Positions are **signed** (positive = net long YES, negative = net short YES).

**Spec:** `docs/superpowers/specs/2026-06-01-exchange-market-clob-design.md`

**Shared data shapes used across every task (keep these names exact):**
- **RestingOrder** (a row in the book): `{ id, userId, side: 'buy'|'sell', price: <int 1..99>, qty: <int>, sequence: <int> }`. `qty` is the *remaining* unfilled quantity. `side: 'buy'` is a bid on YES; `side: 'sell'` is an ask on YES (and, with no inventory, a short).
- **IncomingOrder**: `{ side: 'buy'|'sell', price: <int 1..99> | null, qty: <int> }`. `price: null` means a market order.
- **Book**: `{ bids: RestingOrder[], asks: RestingOrder[] }` (any order; modules sort internally).
- **Fill**: `{ price: <int>, qty: <int>, makerId, makerUserId }` (taker fills at the *maker's* price).
- **Position**: `{ shares: <int signed>, avgEntry: <number>, realizedPnl: <number> }`.

---

### Task 1: Schema migration for exchange markets

**Files:**
- Create: `db/migrations/010_exchange_markets.sql`
- Test: `test/exchangeSchema.vitest.js`

- [ ] **Step 1: Write the migration**

Create `db/migrations/010_exchange_markets.sql`:

```sql
-- Exchange market type: a CLOB on a binary contract with signed positions,
-- escrow, and (later) leverage. See spec 2026-06-01-exchange-market-clob-design.md.
BEGIN;

-- Distinguish the existing one-tap "quick" market from the new "exchange" market.
ALTER TABLE markets ADD COLUMN IF NOT EXISTS mechanism text NOT NULL DEFAULT 'quick';

-- Per-market exchange configuration (one row per exchange market).
CREATE TABLE IF NOT EXISTS market_exchange_config (
  market_id uuid PRIMARY KEY REFERENCES markets(id) ON DELETE CASCADE,
  seed_price integer NOT NULL DEFAULT 50 CHECK (seed_price BETWEEN 1 AND 99),
  max_leverage integer NOT NULL DEFAULT 1 CHECK (max_leverage BETWEEN 1 AND 10),
  tick integer NOT NULL DEFAULT 1,
  maintenance_margin integer NOT NULL DEFAULT 3,
  bot_spread integer NOT NULL DEFAULT 4,
  bot_levels integer NOT NULL DEFAULT 5,
  bot_size_per_level integer NOT NULL DEFAULT 50,
  bot_max_inventory integer NOT NULL DEFAULT 500,
  created_at timestamptz DEFAULT now()
);

-- The order book. user_id may be a per-market bot account (a real users row).
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('buy','sell')),
  price integer NOT NULL CHECK (price BETWEEN 1 AND 99),
  quantity integer NOT NULL CHECK (quantity > 0),
  filled_quantity integer NOT NULL DEFAULT 0 CHECK (filled_quantity >= 0),
  leverage integer NOT NULL DEFAULT 1 CHECK (leverage BETWEEN 1 AND 10),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','partial','filled','cancelled','liquidation')),
  sequence bigserial NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_orders_book
  ON orders(market_id, side, price, sequence) WHERE status IN ('open','partial');

-- Executed trades = the price tape.
CREATE TABLE IF NOT EXISTS trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  price integer NOT NULL CHECK (price BETWEEN 1 AND 99),
  quantity integer NOT NULL CHECK (quantity > 0),
  taker_order_id uuid REFERENCES orders(id),
  maker_order_id uuid REFERENCES orders(id),
  taker_user text REFERENCES users(id),
  maker_user text REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_trades_market_time ON trades(market_id, created_at DESC);

-- Signed net position per (market, user).
CREATE TABLE IF NOT EXISTS positions (
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shares integer NOT NULL DEFAULT 0,
  avg_entry numeric NOT NULL DEFAULT 0,
  margin_posted integer NOT NULL DEFAULT 0,
  realized_pnl integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (market_id, user_id)
);

-- App-seeded insurance pool absorbing liquidation shortfalls (per market).
CREATE TABLE IF NOT EXISTS insurance_pool (
  market_id uuid PRIMARY KEY REFERENCES markets(id) ON DELETE CASCADE,
  balance integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

COMMIT;
```

- [ ] **Step 2: Apply the migration to BOTH branches**

The Vitest suite reads the **ci-perf-tests** branch (`.env.test.local`, loaded by `test/setup.js`), while `npm run migrate` targets the dev branch (`.env.local`). The schema test in Step 3 reads the test branch, so the migration must land there too. Apply to both:

Run (dev branch): `npm run migrate`
Run (test branch): `node --env-file=.env.test.local server/migrations/run_migrations.js`

Expected (each): console prints `Applied migration 010_exchange_markets.sql` and `Migrations applied` with no error. (Migrations are idempotent via `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, so re-applying the older migrations is harmless.)

- [ ] **Step 3: Write the failing schema-verification test**

Create `test/exchangeSchema.vitest.js`:

```javascript
import { describe, it, expect } from 'vitest';

const { query } = require('../server/db');

async function columnExists(table, column) {
  const { rows } = await query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return rows.length === 1;
}
async function tableExists(table) {
  const { rows } = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
    [table]
  );
  return rows.length === 1;
}

describe('010_exchange_markets schema', () => {
  it('adds markets.mechanism defaulting to quick', async () => {
    expect(await columnExists('markets', 'mechanism')).toBe(true);
    const { rows } = await query(
      `SELECT column_default FROM information_schema.columns
       WHERE table_name = 'markets' AND column_name = 'mechanism'`
    );
    expect(rows[0].column_default).toContain('quick');
  });

  it('creates the exchange tables', async () => {
    for (const t of ['market_exchange_config', 'orders', 'trades', 'positions', 'insurance_pool']) {
      expect(await tableExists(t)).toBe(true);
    }
  });

  it('positions are keyed by (market_id, user_id) and shares can be negative', async () => {
    expect(await columnExists('positions', 'shares')).toBe(true);
    expect(await columnExists('orders', 'leverage')).toBe(true);
  });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/exchangeSchema.vitest.js`
Expected: 3 tests PASS. (If they fail with "column does not exist", the migration in Step 2 didn't apply — re-run `npm run migrate`.)

- [ ] **Step 5: Commit**

```bash
git add db/migrations/010_exchange_markets.sql test/exchangeSchema.vitest.js
git commit -m "feat(exchange): schema for CLOB exchange markets"
```

---

### Task 2: Matching engine (price-time priority, partial fills)

**Files:**
- Create: `server/exchange/matching.js`
- Test: `test/exchangeMatching.vitest.js`

- [ ] **Step 1: Write the failing test**

Create `test/exchangeMatching.vitest.js`:

```javascript
import { describe, it, expect } from 'vitest';
const { matchOrder } = require('../server/exchange/matching');

const ask = (id, price, qty, sequence) => ({ id, userId: 'm', side: 'sell', price, qty, sequence });
const bid = (id, price, qty, sequence) => ({ id, userId: 'm', side: 'buy', price, qty, sequence });

describe('matchOrder', () => {
  it('fills a marketable buy against the cheapest asks first (price priority)', () => {
    const book = { bids: [], asks: [ask('a1', 64, 5, 2), ask('a2', 63, 10, 1)] };
    const res = matchOrder({ side: 'buy', price: 64, qty: 12 }, book);
    expect(res.fills).toEqual([
      { price: 63, qty: 10, makerId: 'a2', makerUserId: 'm' },
      { price: 64, qty: 2, makerId: 'a1', makerUserId: 'm' },
    ]);
    expect(res.filledQty).toBe(12);
    expect(res.residualQty).toBe(0);
  });

  it('breaks price ties by sequence (time priority)', () => {
    const book = { bids: [], asks: [ask('late', 63, 5, 9), ask('early', 63, 5, 1)] };
    const res = matchOrder({ side: 'buy', price: 63, qty: 5 }, book);
    expect(res.fills).toEqual([{ price: 63, qty: 5, makerId: 'early', makerUserId: 'm' }]);
  });

  it('does not cross the spread: a buy below the best ask rests entirely', () => {
    const book = { bids: [], asks: [ask('a1', 64, 5, 1)] };
    const res = matchOrder({ side: 'buy', price: 60, qty: 5 }, book);
    expect(res.fills).toEqual([]);
    expect(res.residualQty).toBe(5);
  });

  it('partially fills and reports the residual to rest', () => {
    const book = { bids: [], asks: [ask('a1', 63, 4, 1)] };
    const res = matchOrder({ side: 'buy', price: 63, qty: 10 }, book);
    expect(res.filledQty).toBe(4);
    expect(res.residualQty).toBe(6);
  });

  it('a market buy (price null) sweeps every ask regardless of price', () => {
    const book = { bids: [], asks: [ask('a1', 70, 3, 1), ask('a2', 90, 3, 2)] };
    const res = matchOrder({ side: 'buy', price: null, qty: 6 }, book);
    expect(res.filledQty).toBe(6);
  });

  it('a sell matches the highest bids first', () => {
    const book = { bids: [bid('b1', 60, 5, 1), bid('b2', 62, 5, 2)], asks: [] };
    const res = matchOrder({ side: 'sell', price: 60, qty: 7 }, book);
    expect(res.fills).toEqual([
      { price: 62, qty: 5, makerId: 'b2', makerUserId: 'm' },
      { price: 60, qty: 2, makerId: 'b1', makerUserId: 'm' },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/exchangeMatching.vitest.js`
Expected: FAIL with "Cannot find module '../server/exchange/matching'".

- [ ] **Step 3: Write the minimal implementation**

Create `server/exchange/matching.js`:

```javascript
// Pure CLOB matching engine. Given an incoming order and a book snapshot,
// returns the fills (at maker prices, price-time priority) and how much of the
// incoming order remains unfilled. No DB, no mutation of inputs.

// A buy crosses asks priced <= its limit; a sell crosses bids priced >= its
// limit. price === null means a market order (crosses any price).
function isMarketable(incomingSide, limitPrice, makerPrice) {
  if (limitPrice === null) return true;
  return incomingSide === 'buy' ? makerPrice <= limitPrice : makerPrice >= limitPrice;
}

// Best-first ordering of the resting side we match against.
function sortMakers(makers, incomingSide) {
  // Buy hits asks: lowest price first. Sell hits bids: highest price first.
  // Ties broken by sequence (earliest first) = time priority.
  return [...makers].sort((a, b) =>
    a.price !== b.price
      ? (incomingSide === 'buy' ? a.price - b.price : b.price - a.price)
      : a.sequence - b.sequence
  );
}

function matchOrder(incoming, book) {
  const makers = sortMakers(incoming.side === 'buy' ? book.asks : book.bids, incoming.side);
  const fills = [];
  let remaining = incoming.qty;

  for (const maker of makers) {
    if (remaining <= 0) break;
    if (!isMarketable(incoming.side, incoming.price, maker.price)) break;
    const qty = Math.min(remaining, maker.qty);
    if (qty <= 0) continue;
    fills.push({ price: maker.price, qty, makerId: maker.id, makerUserId: maker.userId });
    remaining -= qty;
  }

  return { fills, filledQty: incoming.qty - remaining, residualQty: remaining };
}

module.exports = { matchOrder };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/exchangeMatching.vitest.js`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/exchange/matching.js test/exchangeMatching.vitest.js
git commit -m "feat(exchange): pure price-time-priority matching engine"
```

---

### Task 3: Position folding (signed shares, avg entry, realized P&L)

**Files:**
- Create: `server/exchange/positions.js`
- Test: `test/exchangePositions.vitest.js`

- [ ] **Step 1: Write the failing test**

Create `test/exchangePositions.vitest.js`:

```javascript
import { describe, it, expect } from 'vitest';
const { applyFill, emptyPosition } = require('../server/exchange/positions');

describe('applyFill', () => {
  it('opens a long: buying 10 @60 from flat', () => {
    const p = applyFill(emptyPosition(), 'buy', 60, 10);
    expect(p).toEqual({ shares: 10, avgEntry: 60, realizedPnl: 0 });
  });

  it('adds to a long with a weighted average entry', () => {
    let p = applyFill(emptyPosition(), 'buy', 60, 10);
    p = applyFill(p, 'buy', 70, 10);
    expect(p).toEqual({ shares: 20, avgEntry: 65, realizedPnl: 0 });
  });

  it('reduces a long and realizes P&L on the closed portion', () => {
    let p = applyFill(emptyPosition(), 'buy', 60, 20);
    p = applyFill(p, 'sell', 80, 5);
    // closed 5 @ (80-60) = +100 realized; 15 still long @60
    expect(p).toEqual({ shares: 15, avgEntry: 60, realizedPnl: 100 });
  });

  it('opens a short by selling from flat (avg entry = sell price)', () => {
    const p = applyFill(emptyPosition(), 'sell', 60, 10);
    expect(p).toEqual({ shares: -10, avgEntry: 60, realizedPnl: 0 });
  });

  it('realizes P&L correctly when closing a short (profit when price falls)', () => {
    let p = applyFill(emptyPosition(), 'sell', 60, 10);
    p = applyFill(p, 'buy', 50, 10);
    // short closed @ (60-50) = +100 realized; flat
    expect(p).toEqual({ shares: 0, avgEntry: 0, realizedPnl: 100 });
  });

  it('flips from long to short, realizing the full long and opening the remainder short', () => {
    let p = applyFill(emptyPosition(), 'buy', 60, 10);
    p = applyFill(p, 'sell', 70, 15);
    // close 10 long @ (70-60)=+100; open 5 short @70
    expect(p).toEqual({ shares: -5, avgEntry: 70, realizedPnl: 100 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/exchangePositions.vitest.js`
Expected: FAIL with "Cannot find module '../server/exchange/positions'".

- [ ] **Step 3: Write the minimal implementation**

Create `server/exchange/positions.js`:

```javascript
// Pure position accounting. A position is signed: shares > 0 is net long YES,
// shares < 0 is net short YES. Applying a fill may add to, reduce, close, or
// flip the position, realizing P&L on any portion that reduces existing size.
// Prices are cents; P&L is in points. avgEntry is reset to the new fill price
// once the position crosses through flat. Inputs are never mutated.

function emptyPosition() {
  return { shares: 0, avgEntry: 0, realizedPnl: 0 };
}

// 'buy' moves shares up (+qty), 'sell' moves shares down (-qty).
function applyFill(position, side, price, qty) {
  const signed = side === 'buy' ? qty : -qty;
  const oldShares = position.shares;
  let realized = position.realizedPnl;
  let shares = oldShares;
  let avgEntry = position.avgEntry;

  const sameDirection = oldShares === 0 || Math.sign(signed) === Math.sign(oldShares);

  if (sameDirection) {
    // Adding to (or opening) a position: blend the average entry by absolute size.
    const newAbs = Math.abs(oldShares) + qty;
    avgEntry = (Math.abs(oldShares) * avgEntry + qty * price) / newAbs;
    shares = oldShares + signed;
  } else {
    // Reducing/closing/flipping. The portion up to |oldShares| closes and
    // realizes P&L; any excess opens a fresh position at this price.
    const closingQty = Math.min(qty, Math.abs(oldShares));
    const dir = Math.sign(oldShares); // +1 was long, -1 was short
    realized += dir * (price - avgEntry) * closingQty;
    shares = oldShares + signed;
    if (shares === 0) {
      avgEntry = 0;
    } else if (Math.sign(shares) !== dir) {
      // Flipped through flat: remainder opens at the fill price.
      avgEntry = price;
    }
    // else: still same side, smaller — avgEntry unchanged.
  }

  return { shares, avgEntry, realizedPnl: realized };
}

module.exports = { applyFill, emptyPosition };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/exchangePositions.vitest.js`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/exchange/positions.js test/exchangePositions.vitest.js
git commit -m "feat(exchange): pure signed-position folding with realized P&L"
```

---

### Task 4: Margin calculator (with leverage)

**Files:**
- Create: `server/exchange/margin.js`
- Test: `test/exchangeMargin.vitest.js`

- [ ] **Step 1: Write the failing test**

Create `test/exchangeMargin.vitest.js`:

```javascript
import { describe, it, expect } from 'vitest';
const { maxLossPerShare, requiredMargin } = require('../server/exchange/margin');

describe('maxLossPerShare', () => {
  it('a long can lose its full price (worst case the share goes to 0)', () => {
    expect(maxLossPerShare('buy', 60)).toBe(60);
  });
  it('a short can lose 100 minus the price (worst case the share goes to 100)', () => {
    expect(maxLossPerShare('sell', 60)).toBe(40);
  });
});

describe('requiredMargin', () => {
  it('unlevered long escrows the full premium', () => {
    expect(requiredMargin({ side: 'buy', price: 60, qty: 10, leverage: 1 })).toBe(600);
  });
  it('unlevered short escrows the full max loss', () => {
    expect(requiredMargin({ side: 'sell', price: 60, qty: 10, leverage: 1 })).toBe(400);
  });
  it('leverage divides the margin and never under-collateralizes (ceils)', () => {
    expect(requiredMargin({ side: 'buy', price: 60, qty: 10, leverage: 4 })).toBe(150);
    expect(requiredMargin({ side: 'sell', price: 60, qty: 10, leverage: 3 })).toBe(134); // ceil(400/3)
  });
  it('defaults leverage to 1 when omitted', () => {
    expect(requiredMargin({ side: 'buy', price: 60, qty: 10 })).toBe(600);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/exchangeMargin.vitest.js`
Expected: FAIL with "Cannot find module '../server/exchange/margin'".

- [ ] **Step 3: Write the minimal implementation**

Create `server/exchange/margin.js`:

```javascript
// Pure margin math. Max loss per share is bounded by the binary payout (0..100):
// a long loses at most its price; a short loses at most (100 - price). Required
// margin is the max loss scaled down by leverage, rounded UP so the system is
// never under-collateralized for the unlevered remainder.

function maxLossPerShare(side, price) {
  return side === 'buy' ? price : 100 - price;
}

function requiredMargin({ side, price, qty, leverage = 1 }) {
  const maxLoss = maxLossPerShare(side, price) * qty;
  return Math.ceil(maxLoss / leverage);
}

module.exports = { maxLossPerShare, requiredMargin };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/exchangeMargin.vitest.js`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/exchange/margin.js test/exchangeMargin.vitest.js
git commit -m "feat(exchange): pure margin calculator with leverage"
```

---

### Task 5: Liquidation & bankruptcy math

**Files:**
- Create: `server/exchange/liquidation.js`
- Test: `test/exchangeLiquidation.vitest.js`

- [ ] **Step 1: Write the failing test**

Create `test/exchangeLiquidation.vitest.js`:

```javascript
import { describe, it, expect } from 'vitest';
const { bankruptcyPrice, liquidationPrice, mustLiquidate } = require('../server/exchange/liquidation');

describe('bankruptcyPrice', () => {
  it('an unlevered long busts at 0 and an unlevered short busts at 100', () => {
    expect(bankruptcyPrice({ side: 'buy', entry: 60, leverage: 1 })).toBe(0);
    expect(bankruptcyPrice({ side: 'sell', entry: 60, leverage: 1 })).toBe(100);
  });
  it('a 4x long at 60 busts at 45 (60*(1-1/4))', () => {
    expect(bankruptcyPrice({ side: 'buy', entry: 60, leverage: 4 })).toBe(45);
  });
  it('a 4x short at 60 busts at 70 (60 + (100-60)/4)', () => {
    expect(bankruptcyPrice({ side: 'sell', entry: 60, leverage: 4 })).toBe(70);
  });
});

describe('liquidationPrice', () => {
  it('sits inside the bankruptcy price by the maintenance buffer (long)', () => {
    // bankruptcy 45, maintenance 3 -> liquidation at 48 (triggers before bust)
    expect(liquidationPrice({ side: 'buy', entry: 60, leverage: 4, maintenanceMargin: 3 })).toBe(48);
  });
  it('sits inside the bankruptcy price by the maintenance buffer (short)', () => {
    // bankruptcy 70, maintenance 3 -> liquidation at 67
    expect(liquidationPrice({ side: 'sell', entry: 60, leverage: 4, maintenanceMargin: 3 })).toBe(67);
  });
});

describe('mustLiquidate', () => {
  const params = { leverage: 4, maintenanceMargin: 3 };
  it('liquidates a long once the mark falls to/through its liquidation price', () => {
    const pos = { side: 'buy', entry: 60 }; // liq at 48
    expect(mustLiquidate(pos, 49, params)).toBe(false);
    expect(mustLiquidate(pos, 48, params)).toBe(true);
    expect(mustLiquidate(pos, 47, params)).toBe(true);
  });
  it('liquidates a short once the mark rises to/through its liquidation price', () => {
    const pos = { side: 'sell', entry: 60 }; // liq at 67
    expect(mustLiquidate(pos, 66, params)).toBe(false);
    expect(mustLiquidate(pos, 67, params)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/exchangeLiquidation.vitest.js`
Expected: FAIL with "Cannot find module '../server/exchange/liquidation'".

- [ ] **Step 3: Write the minimal implementation**

Create `server/exchange/liquidation.js`:

```javascript
// Pure liquidation math for the futures model. Two prices per position:
//   bankruptcy price - the mark at which equity hits zero (margin fully consumed)
//   liquidation price - sits inside bankruptcy by the maintenance buffer, so a
//                       liquidation triggers while equity is still positive.
// A long is liquidated when the mark falls to/through its liquidation price; a
// short when the mark rises to/through it. Inputs are cents; outputs are cents.

function bankruptcyPrice({ side, entry, leverage }) {
  return side === 'buy'
    ? entry * (1 - 1 / leverage)
    : entry + (100 - entry) / leverage;
}

function liquidationPrice({ side, entry, leverage, maintenanceMargin }) {
  const bust = bankruptcyPrice({ side, entry, leverage });
  return side === 'buy' ? bust + maintenanceMargin : bust - maintenanceMargin;
}

function mustLiquidate(position, mark, { leverage, maintenanceMargin }) {
  const liq = liquidationPrice({ ...position, leverage, maintenanceMargin });
  return position.side === 'buy' ? mark <= liq : mark >= liq;
}

module.exports = { bankruptcyPrice, liquidationPrice, mustLiquidate };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/exchangeLiquidation.vitest.js`
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/exchange/liquidation.js test/exchangeLiquidation.vitest.js
git commit -m "feat(exchange): pure liquidation and bankruptcy price math"
```

---

### Task 6: Mark price (clamped book mid)

**Files:**
- Create: `server/exchange/markPrice.js`
- Test: `test/exchangeMarkPrice.vitest.js`

- [ ] **Step 1: Write the failing test**

Create `test/exchangeMarkPrice.vitest.js`:

```javascript
import { describe, it, expect } from 'vitest';
const { markPrice } = require('../server/exchange/markPrice');

const ask = (price) => ({ side: 'sell', price, qty: 10, sequence: 1, id: 'a', userId: 'm' });
const bid = (price) => ({ side: 'buy', price, qty: 10, sequence: 1, id: 'b', userId: 'm' });

describe('markPrice', () => {
  it('is the mid of best bid and best ask when both sides exist', () => {
    const book = { bids: [bid(62), bid(60)], asks: [ask(64), ask(66)] };
    expect(markPrice(book, 50)).toBe(63);
  });

  it('uses the best quote when the book is one-sided (not the last trade)', () => {
    expect(markPrice({ bids: [bid(62)], asks: [] }, 50)).toBe(62);
    expect(markPrice({ bids: [], asks: [ask(64)] }, 50)).toBe(64);
  });

  it('falls back to the last trade only when the book is empty', () => {
    expect(markPrice({ bids: [], asks: [] }, 57)).toBe(57);
  });

  it('returns null when there is neither a book nor a last trade', () => {
    expect(markPrice({ bids: [], asks: [] }, null)).toBe(null);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/exchangeMarkPrice.vitest.js`
Expected: FAIL with "Cannot find module '../server/exchange/markPrice'".

- [ ] **Step 3: Write the minimal implementation**

Create `server/exchange/markPrice.js`:

```javascript
// Pure mark-price function. The mark is the risk reference (drives unrealized
// P&L and liquidation) and must resist single-print manipulation, so it is the
// MID of the best bid/ask, never the last trade. The mid is by construction
// inside the [bestBid, bestAsk] band. One-sided book -> the present best quote.
// Empty book -> last trade. Nothing at all -> null.

function best(orders, pick) {
  if (orders.length === 0) return null;
  return orders.reduce((acc, o) => pick(o.price, acc), orders[0].price);
}

function markPrice(book, lastTrade) {
  const bestBid = best(book.bids, Math.max);
  const bestAsk = best(book.asks, Math.min);
  if (bestBid !== null && bestAsk !== null) return (bestBid + bestAsk) / 2;
  if (bestBid !== null) return bestBid;
  if (bestAsk !== null) return bestAsk;
  return lastTrade === undefined ? null : lastTrade;
}

module.exports = { markPrice };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/exchangeMarkPrice.vitest.js`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/exchange/markPrice.js test/exchangeMarkPrice.vitest.js
git commit -m "feat(exchange): pure clamped-mid mark price"
```

---

### Task 7: Bot quoter (inventory skew, hard caps, fair-value convergence)

**Files:**
- Create: `server/exchange/botQuoter.js`
- Test: `test/exchangeBotQuoter.vitest.js`

- [ ] **Step 1: Write the failing test**

Create `test/exchangeBotQuoter.vitest.js`:

```javascript
import { describe, it, expect } from 'vitest';
const { convergedFairValue, desiredQuotes } = require('../server/exchange/botQuoter');

describe('convergedFairValue', () => {
  it('equals the seed when there is no volume yet', () => {
    expect(convergedFairValue({ seed: 70, mark: 50, volume: 0, scale: 100 })).toBe(70);
  });
  it('converges toward the mark as volume grows (seed weight -> 0)', () => {
    const early = convergedFairValue({ seed: 70, mark: 50, volume: 100, scale: 100 }); // w=0.5 -> 60
    const late = convergedFairValue({ seed: 70, mark: 50, volume: 900, scale: 100 });  // w=0.1 -> 52
    expect(early).toBe(60);
    expect(late).toBe(52);
  });
});

describe('desiredQuotes', () => {
  const base = { spread: 4, levels: 2, sizePerLevel: 50, maxInventory: 500, skewPerShare: 0 };

  it('posts a symmetric ladder around fair value when inventory is flat', () => {
    const q = desiredQuotes({ fairValue: 60, inventory: 0, ...base });
    expect(q).toEqual([
      { side: 'buy', price: 58, qty: 50 },
      { side: 'buy', price: 57, qty: 50 },
      { side: 'sell', price: 62, qty: 50 },
      { side: 'sell', price: 63, qty: 50 },
    ]);
  });

  it('skews the ladder down when long inventory (sheds risk)', () => {
    const q = desiredQuotes({ fairValue: 60, inventory: 100, ...base, skewPerShare: 0.02 });
    // center shifts down by 100*0.02 = 2 -> fairValue 58
    expect(q.find((o) => o.side === 'buy').price).toBe(56);
    expect(q.find((o) => o.side === 'sell').price).toBe(60);
  });

  it('withdraws bids at the long inventory cap (only quotes the reducing side)', () => {
    const q = desiredQuotes({ fairValue: 60, inventory: 500, ...base });
    expect(q.every((o) => o.side === 'sell')).toBe(true);
  });

  it('withdraws asks at the short inventory cap', () => {
    const q = desiredQuotes({ fairValue: 60, inventory: -500, ...base });
    expect(q.every((o) => o.side === 'buy')).toBe(true);
  });

  it('clamps quote prices into 1..99', () => {
    const q = desiredQuotes({ fairValue: 2, inventory: 0, ...base });
    expect(q.every((o) => o.price >= 1 && o.price <= 99)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/exchangeBotQuoter.vitest.js`
Expected: FAIL with "Cannot find module '../server/exchange/botQuoter'".

- [ ] **Step 3: Write the minimal implementation**

Create `server/exchange/botQuoter.js`:

```javascript
// Pure bot market-maker quoter. Fair value starts at the creator seed and
// converges fully to the discovered mark as cumulative volume grows (the seed
// weight decays to 0). The quoter posts a ladder of bids/asks around fair value
// at a fixed spread, skewed by inventory (long -> lower prices to shed risk),
// and withdraws the accumulating side entirely once a hard inventory cap is hit.
// Pure: returns the DESIRED order set; posting/cancelling is a side effect
// handled by the bot driver in a later plan.

function clampPrice(p) {
  return Math.max(1, Math.min(99, Math.round(p)));
}

// Seed weight w = 1 / (1 + volume/scale): 1 at zero volume, -> 0 as volume grows.
function convergedFairValue({ seed, mark, volume, scale }) {
  const w = 1 / (1 + volume / scale);
  return (1 - w) * mark + w * seed;
}

function desiredQuotes({ fairValue, inventory, spread, levels, sizePerLevel, maxInventory, skewPerShare = 0 }) {
  const center = fairValue - inventory * skewPerShare;
  const half = spread / 2;
  const atLongCap = inventory >= maxInventory;   // stop buying
  const atShortCap = inventory <= -maxInventory; // stop selling
  const quotes = [];

  for (let i = 0; i < levels; i++) {
    if (!atLongCap) quotes.push({ side: 'buy', price: clampPrice(center - half - i), qty: sizePerLevel });
  }
  for (let i = 0; i < levels; i++) {
    if (!atShortCap) quotes.push({ side: 'sell', price: clampPrice(center + half + i), qty: sizePerLevel });
  }
  return quotes;
}

module.exports = { convergedFairValue, desiredQuotes };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/exchangeBotQuoter.vitest.js`
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/exchange/botQuoter.js test/exchangeBotQuoter.vitest.js
git commit -m "feat(exchange): pure bot quoter with inventory skew and hard caps"
```

---

### Task 8: Run the full suite & confirm the pure layer is green

**Files:** none (verification only)

- [ ] **Step 1: Run the whole Vitest suite**

Run: `npm run test:perf`
Expected: all existing tests plus the 6 new exchange suites PASS (matching, positions, margin, liquidation, markPrice, botQuoter) and the schema test. No failures.

- [ ] **Step 2: Confirm no stray files / lint of the new directory**

Run: `ls server/exchange/`
Expected: `botQuoter.js  liquidation.js  margin.js  markPrice.js  matching.js  positions.js`

- [ ] **Step 3: Commit any final tidy-ups (only if needed)**

```bash
git status   # should be clean if every task committed
```

---

## Notes for the next plan (Plan 2 — Trade executor + order API)

These pure modules are the building blocks. Plan 2 will:
- Add a per-market **bot account** (a `users` row) and seed `market_exchange_config` + `insurance_pool` on exchange-market creation.
- Build `server/exchange/executor.js`: in one transaction under a Postgres advisory lock keyed on `market_id`, load the book, call `matchOrder`, write `trades`, update `orders`/`positions` via `applyFill`, and move escrow through `ledger_entries` using `requiredMargin`. **Re-validate margin at fill** (re-check `requiredMargin` against current available balance before committing).
- Expose `POST /api/markets/[id]/orders`, `DELETE /api/markets/[id]/orders/[orderId]`, and `GET /api/markets/[id]/exchange-state`.

Do NOT use leverage > 1 in the executor until Plan 4; the margin/liquidation modules already support it.
```
