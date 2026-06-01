# Exchange Trade Executor + Order API (Plan 2 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Wire the pure CLOB modules from Plan 1 to Postgres: a transactional, per-market-serialized trade executor and the order API (place / cancel / aggregated read), supporting **long-only human trading** (buy to open/add, sell to close/reduce). Shorting and leverage are Plan 4.

**Architecture:** A thin stateful layer over the Plan-1 pure core. `placeOrder` runs inside one DB transaction under a Postgres advisory lock keyed on `market_id` (so concurrent orders can't race the book): load book → `matchOrder` → write `trades`, update `orders` + `positions` (via `applyFill`) → record cash in `ledger_entries`. Cash model is pure flows: a buy fill debits the premium, a sell fill credits the proceeds; settlement (Plan 3) pays longs 100/share. No collateral/margin needed because longs can't lose more than the premium already paid.

**Tech Stack:** Node.js (CommonJS), `pg`, Next.js API routes (`pages/api`), Vitest integration tests against the Neon ci-perf-tests branch.

**Spec:** `docs/superpowers/specs/2026-06-01-exchange-market-clob-design.md`
**Builds on:** `docs/superpowers/plans/2026-06-01-exchange-core-pure-clob.md` (Plan 1 — read its "Seam contracts" section).

## Scope guardrails (long-only, Plan 2)

- Humans may **buy** (open/add a long) and **sell only to close/reduce** a long they hold. Opening a short is rejected (Plan 4).
- `leverage` stays `1`. No `positions.margin_posted` usage, no liquidation, no insurance pool.
- No bot yet (Plan 3); integration tests trade between two human accounts.
- **Cash accounting (the invariant):**
  - `available = users.starting_points + Σ ledger_entries.delta − Σ (resting BUY order escrow)`
    where a resting BUY order's escrow = `price × remaining_qty` (`remaining = quantity − filled_quantity`).
  - A buy **fill** of `f` shares at maker price `p` → `ledger_entries(delta = −p·f, reason='buy_fill')`.
  - A sell **fill** of `f` shares at maker price `p` → `ledger_entries(delta = +p·f, reason='sell_fill')`.
  - `positions.realized_pnl` is updated for display (via `applyFill`) but is **NOT** mirrored into the ledger — the cash flows above already are the P&L (double-counting bug otherwise).
  - A **sell** is validated against shares held: `sell_qty ≤ position.shares − (Σ open sell-order remaining_qty)`. Selling more than you hold = an attempt to open a short → **reject** with `short_not_allowed` (Plan 4).

## Shared shapes (from Plan 1, unchanged)

- RestingOrder `{ id, userId, side, price, qty, sequence }` (qty = remaining).
- Fill `{ price, qty, makerId, makerUserId }`.
- Position `{ shares, avgEntry, realizedPnl }`.

---

### Task 1: Exchange market creation (config row + mechanism)

**Files:**
- Create: `server/exchange/createMarket.js`
- Test: `test/exchangeCreateMarket.vitest.js`

- [ ] **Step 1: Write the failing test**

Create `test/exchangeCreateMarket.vitest.js`:

```javascript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uid } from './helpers.js';
const { query, pool } = require('../server/db');
const { createExchangeMarket } = require('../server/exchange/createMarket');

const USER = uid('xc-user');
const GROUP = uid('xc-group');

beforeAll(async () => {
  await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,2000) ON CONFLICT (id) DO NOTHING`, [USER, `${USER}@t.internal`]);
  await query(`INSERT INTO groups (id, name, owner_id) VALUES ($1,'g',$2) ON CONFLICT (id) DO NOTHING`, [GROUP, USER]);
});
afterAll(async () => { await pool.end(); });

describe('createExchangeMarket', () => {
  it('creates a market with mechanism=exchange and an exchange config row', async () => {
    const { marketId } = await createExchangeMarket(
      { groupId: GROUP, creatorId: USER, title: 'Will it ship?', seedPrice: 40 },
      query
    );
    const { rows: m } = await query(`SELECT mechanism FROM markets WHERE id=$1`, [marketId]);
    expect(m[0].mechanism).toBe('exchange');
    const { rows: c } = await query(`SELECT seed_price, max_leverage FROM market_exchange_config WHERE market_id=$1`, [marketId]);
    expect(c[0].seed_price).toBe(40);
    expect(c[0].max_leverage).toBe(1);
  });

  it('defaults the seed price to 50 when omitted', async () => {
    const { marketId } = await createExchangeMarket({ groupId: GROUP, creatorId: USER, title: 'Coin flip?' }, query);
    const { rows: c } = await query(`SELECT seed_price FROM market_exchange_config WHERE market_id=$1`, [marketId]);
    expect(c[0].seed_price).toBe(50);
  });
});
```

- [ ] **Step 2: Run, verify it FAILS** (module missing): `npx vitest run test/exchangeCreateMarket.vitest.js`

- [ ] **Step 3: Write the implementation**

Create `server/exchange/createMarket.js`:

```javascript
// Creates an exchange-type market: a markets row with mechanism='exchange' plus
// its market_exchange_config row. Returns { marketId }. Caller handles auth and
// group membership; this is the data-layer helper.
const { query: defaultQuery } = require('../db');

async function createExchangeMarket({ groupId, creatorId, title, seedPrice = 50 }, q = defaultQuery) {
  const { rows } = await q(
    `INSERT INTO markets (group_id, creator_id, title, type, state, mechanism)
     VALUES ($1, $2, $3, 'binary', 'open', 'exchange') RETURNING id`,
    [groupId, creatorId, title]
  );
  const marketId = rows[0].id;
  await q(
    `INSERT INTO market_exchange_config (market_id, seed_price) VALUES ($1, $2)`,
    [marketId, seedPrice]
  );
  return { marketId };
}

module.exports = { createExchangeMarket };
```

- [ ] **Step 4: Run, verify 2 tests PASS:** `npx vitest run test/exchangeCreateMarket.vitest.js`

- [ ] **Step 5: Commit:**
```bash
git add server/exchange/createMarket.js test/exchangeCreateMarket.vitest.js
git commit -m "feat(exchange): create exchange-type market with config row"
```

---

### Task 2: Book loader

**Files:**
- Create: `server/exchange/book.js`
- Test: `test/exchangeBook.vitest.js`

- [ ] **Step 1: Write the failing test**

Create `test/exchangeBook.vitest.js`:

```javascript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uid } from './helpers.js';
const { query, pool } = require('../server/db');
const { createExchangeMarket } = require('../server/exchange/createMarket');
const { loadBook } = require('../server/exchange/book');

const USER = uid('bk-user');
const GROUP = uid('bk-group');
let marketId;

beforeAll(async () => {
  await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100000) ON CONFLICT (id) DO NOTHING`, [USER, `${USER}@t.internal`]);
  await query(`INSERT INTO groups (id, name, owner_id) VALUES ($1,'g',$2) ON CONFLICT (id) DO NOTHING`, [GROUP, USER]);
  ({ marketId } = await createExchangeMarket({ groupId: GROUP, creatorId: USER, title: 'book test' }, query));
  // Two resting buys and one resting sell with known remaining quantities.
  await query(`INSERT INTO orders (market_id, user_id, side, price, quantity, filled_quantity, status) VALUES
    ($1,$2,'buy',60,10,0,'open'),
    ($1,$2,'buy',58,5,2,'partial'),
    ($1,$2,'sell',64,8,0,'open'),
    ($1,$2,'buy',55,5,5,'filled')`, [marketId, USER]);
});
afterAll(async () => { await pool.end(); });

describe('loadBook', () => {
  it('returns open/partial orders split into bids and asks with REMAINING qty', async () => {
    const book = await loadBook(marketId, query);
    expect(book.bids.map((o) => [o.price, o.qty])).toEqual(expect.arrayContaining([[60, 10], [58, 3]]));
    expect(book.bids.find((o) => o.price === 55)).toBeUndefined(); // filled -> excluded
    expect(book.asks.map((o) => [o.price, o.qty])).toEqual([[64, 8]]);
  });

  it('indexes every resting order by id for maker-side lookup', async () => {
    const book = await loadBook(marketId, query);
    const anyBid = book.bids[0];
    expect(book.byId.get(anyBid.id).side).toBe('buy');
  });
});
```

- [ ] **Step 2: Run, verify it FAILS** (module missing): `npx vitest run test/exchangeBook.vitest.js`

- [ ] **Step 3: Write the implementation**

Create `server/exchange/book.js`:

```javascript
// Loads the live order book for a market from Postgres into the in-memory shape
// the pure matching engine expects: { bids, asks, byId }. Only open/partial
// orders are live; qty is the REMAINING quantity (quantity - filled_quantity).
// byId lets the executor resolve a fill's maker side/user without re-querying.
const { query: defaultQuery } = require('../db');

async function loadBook(marketId, q = defaultQuery) {
  const { rows } = await q(
    `SELECT id, user_id, side, price, (quantity - filled_quantity) AS qty, sequence
     FROM orders
     WHERE market_id = $1 AND status IN ('open','partial')
     ORDER BY sequence ASC`,
    [marketId]
  );
  const bids = [];
  const asks = [];
  const byId = new Map();
  for (const r of rows) {
    const order = { id: r.id, userId: r.user_id, side: r.side, price: r.price, qty: r.qty, sequence: Number(r.sequence) };
    byId.set(order.id, order);
    (order.side === 'buy' ? bids : asks).push(order);
  }
  return { bids, asks, byId };
}

module.exports = { loadBook };
```

- [ ] **Step 4: Run, verify 2 tests PASS:** `npx vitest run test/exchangeBook.vitest.js`

- [ ] **Step 5: Commit:**
```bash
git add server/exchange/book.js test/exchangeBook.vitest.js
git commit -m "feat(exchange): order book loader"
```

---

### Task 3: Available-balance + sellable-shares query helpers

**Files:**
- Create: `server/exchange/accounts.js`
- Test: `test/exchangeAccounts.vitest.js`

- [ ] **Step 1: Write the failing test**

Create `test/exchangeAccounts.vitest.js`:

```javascript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uid } from './helpers.js';
const { query, pool } = require('../server/db');
const { createExchangeMarket } = require('../server/exchange/createMarket');
const { availableCash, sellableShares } = require('../server/exchange/accounts');

const USER = uid('ac-user');
const GROUP = uid('ac-group');
let marketId;

beforeAll(async () => {
  await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,2000) ON CONFLICT (id) DO NOTHING`, [USER, `${USER}@t.internal`]);
  await query(`INSERT INTO groups (id, name, owner_id) VALUES ($1,'g',$2) ON CONFLICT (id) DO NOTHING`, [GROUP, USER]);
  ({ marketId } = await createExchangeMarket({ groupId: GROUP, creatorId: USER, title: 'acct test' }, query));
  // Realized cash: -300 from a prior fill. A resting buy escrow of 60*10=600.
  await query(`INSERT INTO ledger_entries (user_id, market_id, delta, reason) VALUES ($1,$2,-300,'buy_fill')`, [USER, marketId]);
  await query(`INSERT INTO orders (market_id, user_id, side, price, quantity, filled_quantity, status) VALUES ($1,$2,'buy',60,10,0,'open')`, [marketId, USER]);
  // A long position of 12 shares, with 4 already committed to a resting sell.
  await query(`INSERT INTO positions (market_id, user_id, shares, avg_entry) VALUES ($1,$2,12,50)`, [marketId, USER]);
  await query(`INSERT INTO orders (market_id, user_id, side, price, quantity, filled_quantity, status) VALUES ($1,$2,'sell',70,4,0,'open')`, [marketId, USER]);
});
afterAll(async () => { await pool.end(); });

describe('availableCash', () => {
  it('is starting + ledger - resting buy escrow', async () => {
    // 2000 - 300 - (60*10) = 1100
    expect(await availableCash(USER, query)).toBe(1100);
  });
});

describe('sellableShares', () => {
  it('is the long position minus shares already committed to open sell orders', async () => {
    // 12 held - 4 resting sell = 8
    expect(await sellableShares(marketId, USER, query)).toBe(8);
  });
});
```

- [ ] **Step 2: Run, verify it FAILS** (module missing): `npx vitest run test/exchangeAccounts.vitest.js`

- [ ] **Step 3: Write the implementation**

Create `server/exchange/accounts.js`:

```javascript
// Account/balance helpers for the exchange. Computed in single aggregate
// queries (cf. server/queries/balance.js). "Available cash" is settled cash
// (starting + ledger) minus the premium locked by resting BUY orders.
// "Sellable shares" is the long position minus shares already committed to
// open sell orders (so a user can't double-sell the same shares).
const { query: defaultQuery } = require('../db');

async function availableCash(userId, q = defaultQuery) {
  const { rows } = await q(
    `SELECT (
       COALESCE((SELECT starting_points FROM users WHERE id = $1), 2000)
       + COALESCE((SELECT SUM(delta) FROM ledger_entries WHERE user_id = $1), 0)
       - COALESCE((SELECT SUM(price * (quantity - filled_quantity))
                   FROM orders WHERE user_id = $1 AND side = 'buy' AND status IN ('open','partial')), 0)
     )::int AS cash`,
    [userId]
  );
  return rows[0].cash;
}

async function sellableShares(marketId, userId, q = defaultQuery) {
  const { rows } = await q(
    `SELECT (
       COALESCE((SELECT shares FROM positions WHERE market_id = $1 AND user_id = $2), 0)
       - COALESCE((SELECT SUM(quantity - filled_quantity)
                   FROM orders WHERE market_id = $1 AND user_id = $2 AND side = 'sell' AND status IN ('open','partial')), 0)
     )::int AS sellable`,
    [marketId, userId]
  );
  return rows[0].sellable;
}

module.exports = { availableCash, sellableShares };
```

- [ ] **Step 4: Run, verify 2 tests PASS:** `npx vitest run test/exchangeAccounts.vitest.js`

- [ ] **Step 5: Commit:**
```bash
git add server/exchange/accounts.js test/exchangeAccounts.vitest.js
git commit -m "feat(exchange): available-cash and sellable-shares helpers"
```

---

### Task 4: Trade executor (place order, match, settle cash) — the core

**Files:**
- Create: `server/exchange/executor.js`
- Test: `test/exchangeExecutor.vitest.js`

**Design notes for the implementer (read carefully):**
- `placeOrder(input, deps)` where `input = { marketId, userId, side, price, qty, type }` (`type` is `'limit'` or `'market'`; market means `price=null` to the matcher but you still need a numeric escrow basis — for a market BUY, use the worst marketable price = the highest ask it could hit, or simply require enough cash for `99×qty`; for simplicity in Plan 2, **only support `type='limit'`** and reject `type='market'` with `market_orders_plan3` — the bot/market orders come later).
- `deps = { getClient }` (from `server/db.js`) so the whole thing runs in ONE transaction on a dedicated client.
- Steps inside the transaction:
  1. `BEGIN`.
  2. `SELECT pg_advisory_xact_lock(hashtext($marketId))` — serializes all order processing for this market; the lock auto-releases at COMMIT/ROLLBACK.
  3. Verify the market exists, `mechanism='exchange'`, and `state='open'`; else ROLLBACK and return an error result.
  4. **Validate the order** (use the client `q`):
     - `side='sell'`: `qty ≤ sellableShares(marketId, userId, q)`; else error `short_not_allowed`.
     - `side='buy'`: `price × qty ≤ availableCash(userId, q)`; else error `insufficient_cash`.
  5. Insert the incoming order row (status `'open'`, filled_quantity 0, leverage 1) → get its `id` and `sequence`.
  6. `loadBook(marketId, q)` — note this now includes the just-inserted order; **exclude the incoming order id** from the makers before matching (you can't match against yourself; filter `book.bids`/`book.asks` to drop `incoming.id`).
  7. `matchOrder({ side, price, qty }, filteredBook)`.
  8. For each fill (taker = incoming user, maker via `book.byId.get(fill.makerId)`):
     - Update maker order: `filled_quantity += fill.qty`; set `status='filled'` if now complete else `'partial'`.
     - Update **maker** position via `applyFill` with `makerSide = book.byId.get(fill.makerId).side`; persist (see helper below).
     - Update **taker** position via `applyFill` with the incoming `side`; persist.
     - Cash: taker buy → taker ledger `-fill.price*fill.qty 'buy_fill'`, maker (a sell) → maker ledger `+fill.price*fill.qty 'sell_fill'`. Taker sell → taker ledger `+ ... 'sell_fill'`, maker (a buy) → maker ledger `- ... 'buy_fill'`.
     - Insert a `trades` row.
  9. Update the incoming order: `filled_quantity = totalFilled`; `status = 'filled'` if fully filled, else `'partial'` if some filled, else stays `'open'` (it rests).
  10. `COMMIT`. On any error, `ROLLBACK` and rethrow / return error.
- **Persisting a position** (helper inside executor): upsert `positions` with `shares`, `avg_entry`, `realized_pnl = Math.round(p.realizedPnl)` (DB column is integer — see Plan-1 seam contract #2). Use `INSERT … ON CONFLICT (market_id, user_id) DO UPDATE`.
- Round all ledger deltas with `Math.round` (prices are integers here so `price*qty` is already integer, but keep the guard).
- Return `{ status: 'ok', orderId, fills, filledQty, residualQty }` or `{ status: 'error', error }`.

- [ ] **Step 1: Write the failing test**

Create `test/exchangeExecutor.vitest.js`:

```javascript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uid } from './helpers.js';
const db = require('../server/db');
const { query, pool, getClient } = db;
const { createExchangeMarket } = require('../server/exchange/createMarket');
const { placeOrder } = require('../server/exchange/executor');
const { availableCash, sellableShares } = require('../server/exchange/accounts');

const SELLER = uid('ex-seller');
const BUYER = uid('ex-buyer');
const GROUP = uid('ex-group');
let marketId;

beforeAll(async () => {
  await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100000),($3,$4,100000) ON CONFLICT (id) DO NOTHING`,
    [SELLER, `${SELLER}@t.internal`, BUYER, `${BUYER}@t.internal`]);
  await query(`INSERT INTO groups (id, name, owner_id) VALUES ($1,'g',$2) ON CONFLICT (id) DO NOTHING`, [GROUP, SELLER]);
  ({ marketId } = await createExchangeMarket({ groupId: GROUP, creatorId: SELLER, title: 'executor test' }, query));
  // Give SELLER a long inventory of 100 shares @ avg 50 so they can sell (no shorting in Plan 2).
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
    // Buyer paid 63*4 = 252
    expect(await availableCash(BUYER, query)).toBe(before - 252);
    // Buyer now holds +4 shares
    const { rows } = await query(`SELECT shares, avg_entry FROM positions WHERE market_id=$1 AND user_id=$2`, [marketId, BUYER]);
    expect(rows[0].shares).toBe(4);
    expect(Number(rows[0].avg_entry)).toBe(63);
    // Seller's long reduced from 100 to 96
    const { rows: s } = await query(`SELECT shares FROM positions WHERE market_id=$1 AND user_id=$2`, [marketId, SELLER]);
    expect(s[0].shares).toBe(96);
  });

  it('rejects a sell larger than the holder\'s sellable shares (no shorting in Plan 2)', async () => {
    const res = await placeOrder({ marketId, userId: BUYER, side: 'sell', price: 10, qty: 999, type: 'limit' }, deps);
    expect(res.status).toBe('error');
    expect(res.error).toBe('short_not_allowed');
  });

  it('rejects a buy that exceeds available cash', async () => {
    const poor = uid('ex-poor');
    await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100) ON CONFLICT (id) DO NOTHING`, [poor, `${poor}@t.internal`]);
    const res = await placeOrder({ marketId, userId: poor, side: 'buy', price: 90, qty: 50, type: 'limit' }, deps);
    expect(res.status).toBe('error');
    expect(res.error).toBe('insufficient_cash');
  });

  it('rejects market orders in Plan 2', async () => {
    const res = await placeOrder({ marketId, userId: BUYER, side: 'buy', price: null, qty: 1, type: 'market' }, deps);
    expect(res.status).toBe('error');
    expect(res.error).toBe('market_orders_plan3');
  });
});
```

- [ ] **Step 2: Run, verify it FAILS** (module missing): `npx vitest run test/exchangeExecutor.vitest.js`

- [ ] **Step 3: Write the implementation** following the Design notes above.

Create `server/exchange/executor.js`:

```javascript
// Transactional trade executor. Runs the whole place-order flow in ONE
// transaction under a per-market Postgres advisory lock so concurrent orders
// for the same market cannot race the book. Plan 2 is long-only: buys open/add
// longs, sells close/reduce them; opening a short is rejected. Cash flows are
// recorded in ledger_entries (buy_fill debits, sell_fill credits); positions
// track shares/avg_entry/realized_pnl.
const { loadBook } = require('./book');
const { matchOrder } = require('./matching');
const { applyFill, emptyPosition } = require('./positions');

async function loadPosition(q, marketId, userId) {
  const { rows } = await q(
    `SELECT shares, avg_entry, realized_pnl FROM positions WHERE market_id=$1 AND user_id=$2`,
    [marketId, userId]
  );
  if (rows.length === 0) return emptyPosition();
  return { shares: rows[0].shares, avgEntry: Number(rows[0].avg_entry), realizedPnl: rows[0].realized_pnl };
}

async function savePosition(q, marketId, userId, p) {
  await q(
    `INSERT INTO positions (market_id, user_id, shares, avg_entry, realized_pnl, updated_at)
     VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (market_id, user_id)
     DO UPDATE SET shares=$3, avg_entry=$4, realized_pnl=$5, updated_at=now()`,
    [marketId, userId, p.shares, p.avgEntry, Math.round(p.realizedPnl)]
  );
}

async function availableCashTx(q, userId) {
  const { rows } = await q(
    `SELECT (
       COALESCE((SELECT starting_points FROM users WHERE id=$1),2000)
       + COALESCE((SELECT SUM(delta) FROM ledger_entries WHERE user_id=$1),0)
       - COALESCE((SELECT SUM(price*(quantity-filled_quantity)) FROM orders
                   WHERE user_id=$1 AND side='buy' AND status IN ('open','partial')),0)
     )::int AS cash`, [userId]);
  return rows[0].cash;
}

async function sellableSharesTx(q, marketId, userId) {
  const { rows } = await q(
    `SELECT (
       COALESCE((SELECT shares FROM positions WHERE market_id=$1 AND user_id=$2),0)
       - COALESCE((SELECT SUM(quantity-filled_quantity) FROM orders
                   WHERE market_id=$1 AND user_id=$2 AND side='sell' AND status IN ('open','partial')),0)
     )::int AS sellable`, [marketId, userId]);
  return rows[0].sellable;
}

async function placeOrder(input, deps) {
  const { marketId, userId, side, price, qty, type } = input;
  if (type === 'market') return { status: 'error', error: 'market_orders_plan3' };

  const client = await deps.getClient();
  const q = (text, params) => client.query(text, params);
  try {
    await q('BEGIN');
    await q('SELECT pg_advisory_xact_lock(hashtext($1))', [marketId]);

    const { rows: mrows } = await q(`SELECT mechanism, state FROM markets WHERE id=$1`, [marketId]);
    if (mrows.length === 0 || mrows[0].mechanism !== 'exchange' || mrows[0].state !== 'open') {
      await q('ROLLBACK');
      return { status: 'error', error: 'market_not_open' };
    }

    if (side === 'sell') {
      const sellable = await sellableSharesTx(q, marketId, userId);
      if (qty > sellable) { await q('ROLLBACK'); return { status: 'error', error: 'short_not_allowed' }; }
    } else {
      const cash = await availableCashTx(q, userId);
      if (price * qty > cash) { await q('ROLLBACK'); return { status: 'error', error: 'insufficient_cash' }; }
    }

    const { rows: orows } = await q(
      `INSERT INTO orders (market_id, user_id, side, price, quantity, filled_quantity, leverage, status)
       VALUES ($1,$2,$3,$4,$5,0,1,'open') RETURNING id`,
      [marketId, userId, side, price, qty]
    );
    const incomingId = orows[0].id;

    const book = await loadBook(marketId, q);
    book.bids = book.bids.filter((o) => o.id !== incomingId);
    book.asks = book.asks.filter((o) => o.id !== incomingId);

    const { fills, filledQty, residualQty } = matchOrder({ side, price, qty }, book);

    // Load positions we will mutate once, mutate in memory, save once.
    let takerPos = await loadPosition(q, marketId, userId);
    const makerPos = new Map();

    for (const fill of fills) {
      const maker = book.byId.get(fill.makerId);
      // taker
      takerPos = applyFill(takerPos, side, fill.price, fill.qty);
      // maker
      if (!makerPos.has(maker.userId)) makerPos.set(maker.userId, await loadPosition(q, marketId, maker.userId));
      makerPos.set(maker.userId, applyFill(makerPos.get(maker.userId), maker.side, fill.price, fill.qty));

      // maker order fill bookkeeping
      await q(
        `UPDATE orders SET filled_quantity = filled_quantity + $2,
           status = CASE WHEN filled_quantity + $2 >= quantity THEN 'filled' ELSE 'partial' END
         WHERE id = $1`,
        [maker.id, fill.qty]
      );

      // cash: taker
      const takerDelta = side === 'buy' ? -(fill.price * fill.qty) : (fill.price * fill.qty);
      const takerReason = side === 'buy' ? 'buy_fill' : 'sell_fill';
      await q(`INSERT INTO ledger_entries (user_id, market_id, delta, reason) VALUES ($1,$2,$3,$4)`,
        [userId, marketId, Math.round(takerDelta), takerReason]);
      // cash: maker (opposite side)
      const makerDelta = maker.side === 'buy' ? -(fill.price * fill.qty) : (fill.price * fill.qty);
      const makerReason = maker.side === 'buy' ? 'buy_fill' : 'sell_fill';
      await q(`INSERT INTO ledger_entries (user_id, market_id, delta, reason) VALUES ($1,$2,$3,$4)`,
        [maker.userId, marketId, Math.round(makerDelta), makerReason]);

      // trade tape
      await q(
        `INSERT INTO trades (market_id, price, quantity, taker_order_id, maker_order_id, taker_user, maker_user)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [marketId, fill.price, fill.qty, incomingId, maker.id, userId, maker.userId]
      );
    }

    // persist positions
    await savePosition(q, marketId, userId, takerPos);
    for (const [mUser, mPos] of makerPos) await savePosition(q, marketId, mUser, mPos);

    // incoming order final status
    const incomingStatus = filledQty >= qty ? 'filled' : (filledQty > 0 ? 'partial' : 'open');
    await q(`UPDATE orders SET filled_quantity=$2, status=$3 WHERE id=$1`, [incomingId, filledQty, incomingStatus]);

    await q('COMMIT');
    return { status: 'ok', orderId: incomingId, fills, filledQty, residualQty };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { placeOrder };
```

- [ ] **Step 4: Run, verify 5 tests PASS:** `npx vitest run test/exchangeExecutor.vitest.js`

- [ ] **Step 5: Commit:**
```bash
git add server/exchange/executor.js test/exchangeExecutor.vitest.js
git commit -m "feat(exchange): transactional long-only trade executor"
```

---

### Task 5: Cancel order

**Files:**
- Create: `server/exchange/cancelOrder.js`
- Test: `test/exchangeCancel.vitest.js`

- [ ] **Step 1: Write the failing test**

Create `test/exchangeCancel.vitest.js`:

```javascript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uid } from './helpers.js';
const { query, pool, getClient } = require('../server/db');
const { createExchangeMarket } = require('../server/exchange/createMarket');
const { placeOrder } = require('../server/exchange/executor');
const { cancelOrder } = require('../server/exchange/cancelOrder');
const { availableCash } = require('../server/exchange/accounts');

const USER = uid('cx-user');
const GROUP = uid('cx-group');
let marketId;

beforeAll(async () => {
  await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100000) ON CONFLICT (id) DO NOTHING`, [USER, `${USER}@t.internal`]);
  await query(`INSERT INTO groups (id, name, owner_id) VALUES ($1,'g',$2) ON CONFLICT (id) DO NOTHING`, [GROUP, USER]);
  ({ marketId } = await createExchangeMarket({ groupId: GROUP, creatorId: USER, title: 'cancel test' }, query));
});
afterAll(async () => { await pool.end(); });

describe('cancelOrder', () => {
  it('cancels a resting buy and frees its escrow', async () => {
    const before = await availableCash(USER, query);
    const placed = await placeOrder({ marketId, userId: USER, side: 'buy', price: 50, qty: 10, type: 'limit' }, { getClient });
    expect(await availableCash(USER, query)).toBe(before - 500); // escrow held
    const res = await cancelOrder({ orderId: placed.orderId, userId: USER }, { getClient });
    expect(res.status).toBe('ok');
    expect(await availableCash(USER, query)).toBe(before); // escrow freed
    const { rows } = await query(`SELECT status FROM orders WHERE id=$1`, [placed.orderId]);
    expect(rows[0].status).toBe('cancelled');
  });

  it('refuses to cancel an order the user does not own', async () => {
    const other = uid('cx-other');
    await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100000) ON CONFLICT (id) DO NOTHING`, [other, `${other}@t.internal`]);
    const placed = await placeOrder({ marketId, userId: USER, side: 'buy', price: 40, qty: 5, type: 'limit' }, { getClient });
    const res = await cancelOrder({ orderId: placed.orderId, userId: other }, { getClient });
    expect(res.status).toBe('error');
    expect(res.error).toBe('forbidden');
  });
});
```

- [ ] **Step 2: Run, verify it FAILS** (module missing): `npx vitest run test/exchangeCancel.vitest.js`

- [ ] **Step 3: Write the implementation**

Create `server/exchange/cancelOrder.js`:

```javascript
// Cancels a resting (open/partial) order. Escrow is released implicitly: the
// availableCash formula only counts open/partial buy orders, so flipping status
// to 'cancelled' frees the locked premium. Runs under the per-market advisory
// lock to stay consistent with the executor.
async function cancelOrder({ orderId, userId }, deps) {
  const client = await deps.getClient();
  const q = (text, params) => client.query(text, params);
  try {
    await q('BEGIN');
    const { rows } = await q(`SELECT market_id, user_id, status FROM orders WHERE id=$1`, [orderId]);
    if (rows.length === 0) { await q('ROLLBACK'); return { status: 'error', error: 'not_found' }; }
    const order = rows[0];
    if (order.user_id !== userId) { await q('ROLLBACK'); return { status: 'error', error: 'forbidden' }; }
    await q('SELECT pg_advisory_xact_lock(hashtext($1))', [order.market_id]);
    if (!['open', 'partial'].includes(order.status)) { await q('ROLLBACK'); return { status: 'error', error: 'not_cancellable' }; }
    await q(`UPDATE orders SET status='cancelled' WHERE id=$1`, [orderId]);
    await q('COMMIT');
    return { status: 'ok' };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { cancelOrder };
```

- [ ] **Step 4: Run, verify 2 tests PASS:** `npx vitest run test/exchangeCancel.vitest.js`

- [ ] **Step 5: Commit:**
```bash
git add server/exchange/cancelOrder.js test/exchangeCancel.vitest.js
git commit -m "feat(exchange): cancel order and release escrow"
```

---

### Task 6: API endpoints (place / cancel / aggregated state)

**Files:**
- Create: `pages/api/markets/[id]/orders/index.js` (POST place)
- Create: `pages/api/markets/[id]/orders/[orderId].js` (DELETE cancel)
- Create: `pages/api/markets/[id]/exchange-state.js` (GET)
- Create: `server/exchange/exchangeState.js` (the aggregated read used by the GET handler)
- Test: `test/exchangeState.vitest.js`

**Context for the implementer:** Look at `pages/api/markets/[id]/predictions.js` and `pages/api/markets/[id]/resolve.js` for the existing auth + handler pattern in this repo (session via Better Auth, group-membership check, idempotency via `server/idempotency.js`). Match it: authenticate the user, verify membership in the market's group, then call the executor/cancel/state functions. POST body: `{ side, price, qty, type }`. Use the same JSON error shape the existing endpoints use. Reuse the idempotency middleware the way `predictions.js` does so a double-tap collapses to one order.

The aggregated state module is what the test pins down (the HTTP handlers are thin wrappers around it and the executor, which are already tested):

- [ ] **Step 1: Write the failing test**

Create `test/exchangeState.vitest.js`:

```javascript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uid } from './helpers.js';
const { query, pool, getClient } = require('../server/db');
const { createExchangeMarket } = require('../server/exchange/createMarket');
const { placeOrder } = require('../server/exchange/executor');
const { getExchangeState } = require('../server/exchange/exchangeState');

const SELLER = uid('st-seller');
const BUYER = uid('st-buyer');
const GROUP = uid('st-group');
let marketId;

beforeAll(async () => {
  await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100000),($3,$4,100000) ON CONFLICT (id) DO NOTHING`,
    [SELLER, `${SELLER}@t.internal`, BUYER, `${BUYER}@t.internal`]);
  await query(`INSERT INTO groups (id, name, owner_id) VALUES ($1,'g',$2) ON CONFLICT (id) DO NOTHING`, [GROUP, SELLER]);
  await query(`INSERT INTO group_members (group_id, user_id) VALUES ($1,$2),($1,$3) ON CONFLICT DO NOTHING`, [GROUP, SELLER, BUYER]);
  ({ marketId } = await createExchangeMarket({ groupId: GROUP, creatorId: SELLER, title: 'state test' }, query));
  await query(`INSERT INTO positions (market_id, user_id, shares, avg_entry) VALUES ($1,$2,100,50)`, [marketId, SELLER]);
  await placeOrder({ marketId, userId: SELLER, side: 'sell', price: 63, qty: 10, type: 'limit' }, { getClient });
  await placeOrder({ marketId, userId: SELLER, side: 'sell', price: 65, qty: 10, type: 'limit' }, { getClient });
  await placeOrder({ marketId, userId: BUYER, side: 'buy', price: 63, qty: 4, type: 'limit' }, { getClient }); // crosses -> 1 trade
});
afterAll(async () => { await pool.end(); });

describe('getExchangeState', () => {
  it('returns the book ladder, mark, last trade, my position and my open orders', async () => {
    const state = await getExchangeState(marketId, BUYER, query);
    // asks: 6 left @63, 10 @65 ; bids: none resting (buyer fully filled)
    expect(state.book.asks).toEqual(expect.arrayContaining([{ price: 63, qty: 6 }, { price: 65, qty: 10 }]));
    expect(state.lastTrade).toBe(63);
    expect(state.myPosition.shares).toBe(4);
    expect(Array.isArray(state.myOpenOrders)).toBe(true);
    expect(typeof state.mark).toBe('number');
  });
});
```

- [ ] **Step 2: Run, verify it FAILS** (module missing): `npx vitest run test/exchangeState.vitest.js`

- [ ] **Step 3: Write `server/exchange/exchangeState.js`**

```javascript
// Aggregated read for the exchange detail page / poll. One parallel batch of
// queries (cf. server/queries/marketDetail.js): book depth ladder (price ->
// summed remaining qty), mark price, last trade, the viewer's position and
// open orders. Read-only.
const { query: defaultQuery } = require('../db');
const { loadBook } = require('./book');
const { markPrice } = require('./markPrice');

function ladder(orders) {
  const byPrice = new Map();
  for (const o of orders) byPrice.set(o.price, (byPrice.get(o.price) || 0) + o.qty);
  return [...byPrice.entries()].map(([price, qty]) => ({ price, qty }));
}

async function getExchangeState(marketId, userId, q = defaultQuery) {
  const book = await loadBook(marketId, q);
  const [lastTradeRes, posRes, ordersRes] = await Promise.all([
    q(`SELECT price FROM trades WHERE market_id=$1 ORDER BY created_at DESC LIMIT 1`, [marketId]),
    q(`SELECT shares, avg_entry, realized_pnl FROM positions WHERE market_id=$1 AND user_id=$2`, [marketId, userId]),
    q(`SELECT id, side, price, (quantity-filled_quantity) AS qty, status FROM orders
       WHERE market_id=$1 AND user_id=$2 AND status IN ('open','partial') ORDER BY sequence ASC`, [marketId, userId]),
  ]);
  const lastTrade = lastTradeRes.rows[0] ? lastTradeRes.rows[0].price : null;
  const pos = posRes.rows[0]
    ? { shares: posRes.rows[0].shares, avgEntry: Number(posRes.rows[0].avg_entry), realizedPnl: posRes.rows[0].realized_pnl }
    : { shares: 0, avgEntry: 0, realizedPnl: 0 };
  return {
    book: { bids: ladder(book.bids), asks: ladder(book.asks) },
    mark: markPrice(book, lastTrade),
    lastTrade,
    myPosition: pos,
    myOpenOrders: ordersRes.rows.map((r) => ({ id: r.id, side: r.side, price: r.price, qty: r.qty, status: r.status })),
  };
}

module.exports = { getExchangeState };
```

- [ ] **Step 4: Run, verify the test PASSES:** `npx vitest run test/exchangeState.vitest.js`

- [ ] **Step 5: Write the three HTTP handlers** (thin wrappers; follow `pages/api/markets/[id]/predictions.js` exactly for auth/membership/idempotency).

`pages/api/markets/[id]/orders/index.js` — POST only: authenticate; load market + verify group membership (403 if not a member); parse `{ side, price, qty, type }`; basic validation (`side` in buy/sell, `qty` a positive integer, `price` integer 1..99 for limit); call `placeOrder({ marketId: id, userId, side, price, qty, type }, { getClient })`; map executor error codes to HTTP (`short_not_allowed`/`insufficient_cash`/`market_not_open` → 400 with `{error}`, `market_orders_plan3` → 400) and `ok` → 200 with the result. Wrap with the idempotency middleware as `predictions.js` does.

`pages/api/markets/[id]/orders/[orderId].js` — DELETE only: authenticate; call `cancelOrder({ orderId, userId }, { getClient })`; `forbidden` → 403, `not_found` → 404, `not_cancellable` → 409, `ok` → 200.

`pages/api/markets/[id]/exchange-state.js` — GET only: authenticate; verify membership; return `getExchangeState(id, userId, query)` as JSON (200).

- [ ] **Step 6: Manual sanity check** (no automated HTTP test harness exists in this repo; the logic is covered by the module tests). Verify the files import the same auth helpers as `predictions.js` and that `npx next build` does not error on these routes:

Run: `npx next build 2>&1 | tail -20`
Expected: build completes without errors referencing the new API files. (If the full build is too slow/unrelated-failing, at minimum confirm the files parse with `node --check pages/api/markets/[id]/orders/index.js` etc.)

- [ ] **Step 7: Commit:**
```bash
git add server/exchange/exchangeState.js test/exchangeState.vitest.js "pages/api/markets/[id]/orders/index.js" "pages/api/markets/[id]/orders/[orderId].js" "pages/api/markets/[id]/exchange-state.js"
git commit -m "feat(exchange): order place/cancel/state API endpoints"
```

---

### Task 7: Full suite green

- [ ] **Step 1: Run the whole Vitest suite:** `npm run test:perf`
Expected: all prior suites + the new Plan-2 suites (createMarket, book, accounts, executor, cancel, state) PASS. No failures.

- [ ] **Step 2: Confirm working tree is clean** (every task committed): `git status --short` (only pre-existing unrelated edits, if any, remain).

---

## Notes for the next plan (Plan 3 — bot driver + settlement)

- The **bot** is a per-market designated MM account (a `users` row, e.g. id `bot:<marketId>`). It is the ONLY account allowed to open shorts in Plan 3 (so it can quote asks without inventory); its shorts are app-backed. Seed it with a large `starting_points` or exempt it from the cash check via an `isBot` flag in the executor.
- Bot driver: after any fill touching the bot (detect in `placeOrder` when a maker/taker is the bot) and on a cron, call `convergedFairValue` + `desiredQuotes`, **dedupe rungs by (side, price)** (Plan-1 Task-7 note), cancel the bot's stale orders, and place the new ladder via a bot-privileged path.
- Settlement RPC `market_resolve_exchange`: cancel all open orders; pay long shares 100 (YES) / 0 (NO), charge the bot's shorts symmetrically; write `ledger_entries` reason `settlement`; set market `state='resolved'`. Reuse `resolveHandler.js`'s branch-by-mechanism.
- When Plan 4 adds human shorting+leverage, revisit `availableCash`/`sellableShares` to add short-collateral and `positions.margin_posted`.
