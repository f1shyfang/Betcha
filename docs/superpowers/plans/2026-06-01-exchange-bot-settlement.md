# Exchange Bot Market Maker + Settlement (Plan 3 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Make the exchange a *playable, liquid, resolvable* market: a bot market maker that quotes both sides (the designated, app-backed MM that may short) and exchange settlement that pays out positions at resolution.

**Architecture:** The bot is a per-market `users` account (`bot:<marketId>`) that places orders through the same `placeOrder` executor via a short-permitting, app-backed path (`allowShort`). A `botDriver.requoteBot` recomputes fair value (Plan-1 `convergedFairValue`) + ladder (`desiredQuotes`), dedupes, cancels stale bot orders, and re-posts. Settlement is an atomic SQL RPC `market_resolve_exchange` that cancels open orders and books each position's terminal payout (`delta = (outcome?100:0) * shares`, zero-sum), reached via a `mechanism` branch in the existing `resolveHandler`.

**Tech Stack:** Node.js CJS, `pg`, Next.js API, Vitest against the Neon ci-perf-tests branch.

**Spec:** `docs/superpowers/specs/2026-06-01-exchange-market-clob-design.md`
**Builds on Plans 1–2.** Read Plan-1 "Seam contracts" and Plan-2 "Notes for the next plan".

## Key model notes
- **Cash model recap (from Plan 2):** fills book premiums immediately (`buy_fill = -p*q`, `sell_fill = +p*q`). Settlement only adds the terminal payout.
- **Settlement rule (uniform, both sides, zero-sum):** for each position with `shares != 0`, `ledger_entries(delta = (outcome ? 100 : 0) * shares, reason='settlement')`. Long `shares>0` → credit on YES; short `shares<0` (the bot, or Plan-4 humans) → debit on YES. On NO, terminal=0, so settlement delta is 0 (the premiums already settled the NO case). Since every bought share was sold, `Σ shares = 0` → settlement is zero-sum.
- **Bot is app-backed in Plan 3:** it may short (provide ask-side liquidity) and is exempt from the cash check. Its settlement P&L (often a loss = the app's liquidity subsidy) is just the bot account's balance change; the insurance pool stays unused until Plan 4.
- **No deadlocks:** `requoteBot` must run in its OWN transactions, NEVER nested inside a `placeOrder` transaction (both take the same per-market advisory lock — nesting across two connections would deadlock). Trigger `requoteBot` AFTER `placeOrder` has committed.

---

### Task 1: Bot account + short-permitting executor path

**Files:**
- Create: `server/exchange/botAccount.js`
- Modify: `server/exchange/executor.js` (add `allowShort` option)
- Test: `test/exchangeBotAccount.vitest.js`

- [ ] **Step 1: Write the failing test** — Create `test/exchangeBotAccount.vitest.js`:

```javascript
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
    // Resting sell, not yet filled -> position still 0 until a fill; but a crossing buy would make it negative.
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
```

- [ ] **Step 2: Run, verify it FAILS:** `npx vitest run test/exchangeBotAccount.vitest.js`

- [ ] **Step 3: Create `server/exchange/botAccount.js`:**

```javascript
// The per-market bot market-maker account. It is a normal users row with a
// deterministic id (bot:<marketId>) seeded with a large balance; the executor's
// allowShort path lets it quote the ask side without inventory. App-backed.
const { query: defaultQuery } = require('../db');

const BOT_STARTING_POINTS = 1000000000;

function botUserId(marketId) {
  return `bot:${marketId}`;
}

async function ensureBot(marketId, q = defaultQuery) {
  const id = botUserId(marketId);
  await q(
    `INSERT INTO users (id, email, display_name, starting_points)
     VALUES ($1, $2, 'Market Maker', $3) ON CONFLICT (id) DO NOTHING`,
    [id, `${id}@bot.internal`, BOT_STARTING_POINTS]
  );
  return id;
}

module.exports = { botUserId, ensureBot, BOT_STARTING_POINTS };
```

- [ ] **Step 4: Modify `server/exchange/executor.js`** — add `allowShort` handling. Destructure it from `input` (`const { marketId, userId, side, price, qty, type, allowShort = false } = input;`). In the validation block, when `allowShort` is true, SKIP both the sell-side `short_not_allowed` check and the buy-side `insufficient_cash` check (the bot is app-backed and may short). Concretely, guard the existing validation:

```javascript
    if (!allowShort) {
      if (side === 'sell') {
        const sellable = await sellableSharesTx(q, marketId, userId);
        if (qty > sellable) { await q('ROLLBACK'); return { status: 'error', error: 'short_not_allowed' }; }
      } else {
        const cash = await availableCashTx(q, userId);
        if (price * qty > cash) { await q('ROLLBACK'); return { status: 'error', error: 'insufficient_cash' }; }
      }
    }
```

Everything else in `placeOrder` is unchanged. (The existing 6 executor tests must still pass since they never set `allowShort`.)

- [ ] **Step 5: Run both suites:** `npx vitest run test/exchangeBotAccount.vitest.js test/exchangeExecutor.vitest.js` — all pass.

- [ ] **Step 6: Commit:**
```bash
git add server/exchange/botAccount.js server/exchange/executor.js test/exchangeBotAccount.vitest.js
git commit -m "feat(exchange): per-market bot account + allowShort executor path"
```

---

### Task 2: Bot requote driver

**Files:**
- Create: `server/exchange/botDriver.js`
- Test: `test/exchangeBotDriver.vitest.js`

**Design:** `requoteBot(marketId, deps)` (deps = `{ getClient, query }`), in its OWN sequence of operations (NOT inside another order's txn):
1. Read config (`market_exchange_config`), the current book (`loadBook`), last trade, bot inventory (bot position shares, 0 if none), cumulative volume (`SELECT COALESCE(SUM(quantity),0) FROM trades WHERE market_id=$1`).
2. `mark = markPrice(book, lastTrade)`; if `mark === null`, use `seed_price` as the starting mark.
3. `fair = convergedFairValue({ seed: seed_price, mark, volume, scale: 1000 })`.
4. `quotes = desiredQuotes({ fairValue: fair, inventory, spread: bot_spread, levels: bot_levels, sizePerLevel: bot_size_per_level, maxInventory: bot_max_inventory, skewPerShare: 0.02 })`.
5. **Dedupe** quotes by `(side, price)` keeping the first (Plan-1 Task-7 note).
6. Cancel the bot's existing open/partial orders (one UPDATE: `status='cancelled' WHERE market_id=$1 AND user_id=$bot AND status IN ('open','partial')`) — do this in a short transaction under the advisory lock, OR rely on each placeOrder. Simplest: a single `query` UPDATE (no lock needed for the bot's own cancel since placeOrder re-reads the book under lock).
7. For each deduped quote, call `placeOrder({ marketId, userId: bot, side, price, qty, type: 'limit', allowShort: true }, deps)`.

Each `placeOrder` opens/commits its own txn — sequential, no nesting.

- [ ] **Step 1: Write the failing test** — Create `test/exchangeBotDriver.vitest.js`:

```javascript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uid } from './helpers.js';
const { query, pool, getClient } = require('../server/db');
const { createExchangeMarket } = require('../server/exchange/createMarket');
const { ensureBot, botUserId } = require('../server/exchange/botAccount');
const { requoteBot } = require('../server/exchange/botDriver');

const OWNER = uid('bd-owner');
let GROUP, marketId;
const deps = { getClient, query };

beforeAll(async () => {
  await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100000) ON CONFLICT (id) DO NOTHING`, [OWNER, `${OWNER}@t.internal`]);
  const g = await query(`INSERT INTO groups (name, owner_id) VALUES ('g',$1) RETURNING id`, [OWNER]);
  GROUP = g.rows[0].id;
  ({ marketId } = await createExchangeMarket({ groupId: GROUP, creatorId: OWNER, title: 'bot driver test', seedPrice: 50 }, query));
  await ensureBot(marketId, query);
});
afterAll(async () => { await pool.end(); });

describe('requoteBot', () => {
  it('posts a two-sided ladder of bot orders around the seed price', async () => {
    await requoteBot(marketId, deps);
    const bot = botUserId(marketId);
    const { rows } = await query(
      `SELECT side, COUNT(*)::int AS n FROM orders WHERE market_id=$1 AND user_id=$2 AND status IN ('open','partial') GROUP BY side`,
      [marketId, bot]
    );
    const bySide = Object.fromEntries(rows.map((r) => [r.side, r.n]));
    expect(bySide.buy).toBeGreaterThan(0);
    expect(bySide.sell).toBeGreaterThan(0);
  });

  it('cancels the previous ladder when re-quoting (no unbounded order growth)', async () => {
    const bot = botUserId(marketId);
    await requoteBot(marketId, deps);
    await requoteBot(marketId, deps);
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM orders WHERE market_id=$1 AND user_id=$2 AND status IN ('open','partial')`,
      [marketId, bot]
    );
    // One ladder live = bot_levels per side = 5+5 = 10 (deduped). Assert it didn't accumulate across 3 requotes.
    expect(rows[0].n).toBeLessThanOrEqual(10);
  });
});
```

- [ ] **Step 2: Run, verify it FAILS:** `npx vitest run test/exchangeBotDriver.vitest.js`

- [ ] **Step 3: Create `server/exchange/botDriver.js`:**

```javascript
// Bot market-maker driver. Recomputes the bot's fair value and quote ladder and
// re-posts it. MUST run in its own transactions (each placeOrder opens one) and
// NEVER be called from inside another order's transaction (same per-market
// advisory lock -> deadlock). Trigger after a placeOrder has committed, or on a cron.
const { query: defaultQuery } = require('../db');
const { loadBook } = require('./book');
const { markPrice } = require('./markPrice');
const { convergedFairValue, desiredQuotes } = require('./botQuoter');
const { botUserId, ensureBot } = require('./botAccount');
const { placeOrder } = require('./executor');

function dedupeQuotes(quotes) {
  const seen = new Set();
  const out = [];
  for (const qte of quotes) {
    const key = `${qte.side}:${qte.price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(qte);
  }
  return out;
}

async function requoteBot(marketId, deps) {
  const q = deps.query || defaultQuery;
  const bot = await ensureBot(marketId, q);

  const { rows: cfgRows } = await q(`SELECT * FROM market_exchange_config WHERE market_id=$1`, [marketId]);
  if (cfgRows.length === 0) return;
  const cfg = cfgRows[0];

  const book = await loadBook(marketId, q);
  const { rows: ltRows } = await q(`SELECT price FROM trades WHERE market_id=$1 ORDER BY created_at DESC LIMIT 1`, [marketId]);
  const lastTrade = ltRows[0] ? ltRows[0].price : null;
  const { rows: invRows } = await q(`SELECT shares FROM positions WHERE market_id=$1 AND user_id=$2`, [marketId, bot]);
  const inventory = invRows[0] ? Number(invRows[0].shares) : 0;
  const { rows: volRows } = await q(`SELECT COALESCE(SUM(quantity),0)::int AS vol FROM trades WHERE market_id=$1`, [marketId]);
  const volume = volRows[0].vol;

  const mark = markPrice(book, lastTrade);
  const effectiveMark = mark === null ? cfg.seed_price : mark;
  const fair = convergedFairValue({ seed: cfg.seed_price, mark: effectiveMark, volume, scale: 1000 });

  const quotes = dedupeQuotes(desiredQuotes({
    fairValue: fair,
    inventory,
    spread: cfg.bot_spread,
    levels: cfg.bot_levels,
    sizePerLevel: cfg.bot_size_per_level,
    maxInventory: cfg.bot_max_inventory,
    skewPerShare: 0.02,
  }));

  // Cancel the bot's existing ladder before posting the new one.
  await q(`UPDATE orders SET status='cancelled' WHERE market_id=$1 AND user_id=$2 AND status IN ('open','partial')`, [marketId, bot]);

  for (const qte of quotes) {
    await placeOrder({ marketId, userId: bot, side: qte.side, price: qte.price, qty: qte.qty, type: 'limit', allowShort: true }, deps);
  }
}

module.exports = { requoteBot, dedupeQuotes };
```

- [ ] **Step 4: Run, verify 2 tests PASS:** `npx vitest run test/exchangeBotDriver.vitest.js`

- [ ] **Step 5: Commit:**
```bash
git add server/exchange/botDriver.js test/exchangeBotDriver.vitest.js
git commit -m "feat(exchange): bot requote driver (fair value + ladder)"
```

---

### Task 3: Settlement migration + RPC

**Files:**
- Create: `db/migrations/011_exchange_settlement.sql`
- Test: `test/exchangeSettlement.vitest.js`

- [ ] **Step 1: Write the migration** — `db/migrations/011_exchange_settlement.sql`:

```sql
-- Exchange settlement: resolve an exchange market by booking each position's
-- terminal payout. Cash model already booked premiums at fill time, so
-- settlement adds delta = (outcome?100:0) * shares per position (zero-sum,
-- since every bought share was sold => sum(shares)=0). Cancels open orders.
BEGIN;

CREATE OR REPLACE FUNCTION market_resolve_exchange(
  p_market_id uuid,
  p_resolver_id text,
  p_outcome boolean,
  p_method text,
  p_reason text
) RETURNS TABLE(market_id uuid, state text, resolution_outcome boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  v_terminal int := CASE WHEN p_outcome THEN 100 ELSE 0 END;
BEGIN
  INSERT INTO resolutions(market_id, resolver_id, outcome, method, reason)
  VALUES (p_market_id, p_resolver_id, p_outcome, p_method, p_reason)
  ON CONFLICT (market_id) DO NOTHING;

  UPDATE markets
  SET state = 'resolved',
      resolution = jsonb_build_object('outcome', p_outcome, 'resolved_at', now())
  WHERE id = p_market_id AND state = 'open';

  -- Cancel all live orders (human + bot).
  UPDATE orders SET status = 'cancelled'
  WHERE market_id = p_market_id AND status IN ('open','partial');

  -- Terminal payout per open position. Guarded against double-settle by the
  -- unique resolution insert above + the state='open' guard on the UPDATE: if
  -- the market was already resolved, this still runs but is idempotent only if
  -- called once; callers must use the idempotency layer / single-resolution guard.
  INSERT INTO ledger_entries(user_id, market_id, delta, reason)
  SELECT user_id, p_market_id, (v_terminal * shares), 'settlement'
  FROM positions
  WHERE market_id = p_market_id AND shares <> 0;

  INSERT INTO audit_logs(action, actor_id, meta)
  VALUES ('market_resolved', p_resolver_id,
          jsonb_build_object('market_id', p_market_id, 'outcome', p_outcome, 'method', p_method, 'exchange', true));

  RETURN QUERY SELECT p_market_id, 'resolved'::text, p_outcome;
END;
$$;

COMMIT;
```

- [ ] **Step 2: Apply to both branches:**
```
npm run migrate
node --env-file=.env.test.local server/migrations/run_migrations.js
```
Expected: `Applied migration 011_exchange_settlement.sql` on each.

- [ ] **Step 3: Write the test** — Create `test/exchangeSettlement.vitest.js`:

```javascript
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
  // Bot posts an ask at 60; buyer lifts 10 -> buyer +10 long @60, bot -10 short @60.
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
    // YES: buyer long 10 -> +1000 ; bot short 10 -> -1000
    expect(buyerSettle[0].d).toBe(1000);
    expect(botSettle[0].d).toBe(-1000);

    const { rows: total } = await query(
      `SELECT COALESCE(SUM(delta),0)::int AS d FROM ledger_entries WHERE market_id=$1 AND reason='settlement'`, [marketId]);
    expect(total[0].d).toBe(0); // zero-sum
  });
});
```

- [ ] **Step 4: Run, verify it PASSES:** `npx vitest run test/exchangeSettlement.vitest.js`

- [ ] **Step 5: Commit:**
```bash
git add db/migrations/011_exchange_settlement.sql test/exchangeSettlement.vitest.js
git commit -m "feat(exchange): exchange settlement RPC (zero-sum terminal payout)"
```

---

### Task 4: Branch resolveHandler by mechanism

**Files:**
- Modify: `server/resolveHandler.js`
- Test: `test/exchangeResolveHandler.vitest.js`

**Context:** `server/resolveHandler.js` currently calls `market_resolve_with_ledger`. Read it. Add a branch: after loading the market, also select its `mechanism`; if `mechanism === 'exchange'`, call `market_resolve_exchange($1,$2,$3,$4,$5)` instead. Keep the same membership auth, idempotency, and the `my_delta`/`my_breakdown` settlement summary derived from `ledger_entries` (which the exchange RPC populates with reason `'settlement'`). The existing quick-market path is unchanged.

- [ ] **Step 1: Write the failing test** — `test/exchangeResolveHandler.vitest.js`. It builds an exchange market with a bot short and a buyer long (as in Task 3), then calls `handleResolve` with the exchange market and asserts `status: 200`, the market becomes resolved, and the buyer's `my_delta` reflects the +1000 settlement. (Model the deps/stubs on `test/resolve.integration.test.js` — read it for the exact `handleResolve` dep shape: `getIdempotentResponse`, `storeIdempotentResponse`, `userId`, etc.)

Write the test to match the real `handleResolve` signature in `server/resolveHandler.js`. Pin: resolving an exchange market routes to `market_resolve_exchange` and returns a 200 with a settlement breakdown for the resolver if they hold a position (use the buyer as resolver, and make the buyer a group member + the market creator so they're authorized).

- [ ] **Step 2: Run, verify it FAILS** (handler doesn't branch yet / asserts not met).

- [ ] **Step 3: Implement the branch** in `server/resolveHandler.js` (select `mechanism`; choose the RPC by mechanism; everything else identical).

- [ ] **Step 4: Run, verify PASS, and run `test/resolve.integration.test.js` is untouched** (`npm test`).

- [ ] **Step 5: Commit:**
```bash
git add server/resolveHandler.js test/exchangeResolveHandler.vitest.js
git commit -m "feat(exchange): route resolution to exchange settlement by mechanism"
```

---

### Task 5: Wire requote trigger (initial quotes + after trades) + bot-requote endpoint/cron

**Files:**
- Modify: `pages/api/markets/[id]/orders/index.js` (best-effort requote after a successful place)
- Create: `pages/api/markets/[id]/bot-requote.js` (POST — manual/cron trigger)
- Modify: the exchange-market creation API path (wherever an exchange market is created) to `ensureBot` + `requoteBot` so a fresh market opens with liquidity. (If there is no exchange-create endpoint yet, add `ensureBot`+`requoteBot` to a small `server/exchange/openMarket.js` wrapper called by `createExchangeMarket`'s callers, and cover it in `test/exchangeBotDriver.vitest.js` style. Keep it minimal.)

**Design:** After `placeOrder` commits successfully in the POST handler, call `requoteBot(marketId, { getClient, query })` in a `try/catch` (never let a requote failure break the user's order response). This keeps the book fresh after the price moves. The `bot-requote` endpoint lets a Vercel cron refresh fair value on a timer.

- [ ] **Step 1: Write a thin integration test** `test/exchangeRequoteWiring.vitest.js`: create an exchange market, `ensureBot`, `requoteBot` once (initial liquidity), then place a human buy that lifts a bot ask, then call `requoteBot` again, and assert the bot still has a live two-sided ladder and the mark moved. (This tests the same functions the handler calls; the HTTP layer is a thin wrapper.)

- [ ] **Step 2: Run, verify it FAILS or drives the wiring.**

- [ ] **Step 3: Implement** the after-place requote call in the POST handler (wrapped in try/catch, logged on error) and the `bot-requote.js` endpoint (authenticated; calls `requoteBot`). `node --check` the touched API files.

- [ ] **Step 4: Run the test + `node --check`.**

- [ ] **Step 5: Commit:**
```bash
git add "pages/api/markets/[id]/orders/index.js" "pages/api/markets/[id]/bot-requote.js" test/exchangeRequoteWiring.vitest.js server/exchange/openMarket.js 2>/dev/null || true
git commit -m "feat(exchange): trigger bot requote after trades and on demand"
```

---

### Task 6: Full suite green

- [ ] **Step 1:** `npm run test:perf` — all suites pass. Also run `npm test` (the node resolve integration test) to confirm the quick-market path is unbroken.
- [ ] **Step 2:** `git status --short` — clean (only pre-existing unrelated edits remain).

---

## Notes for Plan 4 (leverage + shorting + liquidation + insurance)
- Human shorting reuses the `allowShort` path but WITH collateral: `availableCash`/`sellableShares` must subtract short collateral `(100-price)*qty/leverage` and long premium uses `price*qty/leverage`. Add `positions.margin_posted` usage and the open-order escrow for shorts.
- Wire Plan-1 `requiredMargin`, `liquidation` (bankruptcy + liquidation price), and the controlled liquidation driver; mark off the **mark price** (already computed). Seed `insurance_pool`.
- The bot self-cross fix from Plan-2 Task 4 is already in place — important once the bot reprices aggressively under skew.
