# Exchange Leverage + Shorting + Liquidation + Insurance (Plan 4 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Give humans first-class shorting and isolated-margin leverage (up to `max_leverage`, default raise to 10), with mark-price-driven controlled liquidation and an insurance pool — wiring in the Plan-1 pure margin/liquidation math.

**Architecture (IMPORTANT — accounting model migration):** Plans 2–3 used a *cash-premium* model (fills booked `buy_fill`/`sell_fill`; settlement added `terminal × shares`). Leverage makes that impossible (a 5× long can't pay full premium). This plan migrates exchange accounting to a **margin/equity model**:
- A position locks **margin** = `requiredMargin(side, avg_entry, |shares|, leverage)` (Plan-1 `margin.js`), stored in `positions.margin_posted`. Longs AND shorts post margin (no more "longs need none").
- Fills no longer book premium to the ledger. Instead they update the position and **realize P&L** only on the reducing/closing portion → `ledger_entries(reason='realized_pnl')` (rounded).
- `available = starting + Σ ledger − Σ position margin_posted − Σ open-order escrow`, where open-order escrow = `requiredMargin` of the resting order's remaining qty+leverage.
- **Settlement** changes to `delta = (terminal − avg_entry) × shares` per open position (full P&L, since premiums were never booked), then release margin. terminal = `outcome ? 100 : 0`.
- **Conservation invariant (get this right):** with average-cost accounting, `Σ settlement` ALONE is NOT zero once there have been intermediate closes (a close realizes P&L against avg-cost, leaving the counterparty's offsetting change in *unrealized* P&L). The conserved quantity is **`Σ (realized_pnl + settlement)` over ALL participants in the market = 0** (no points minted/burned except the insurance/bot subsidy). Tests must assert THIS, not settlement-alone. In the SIMPLE open-then-settle case (no intermediate closes, matched entries), settlement-alone does net to 0 — fine to assert there — but the general invariant is total-market-ledger = 0.
- This **replaces** the Plan-2 executor cash logic and the Plan-3 settlement formula, and updates their tests. The matching engine, book loader, bot driver, and pure modules are unchanged.

**Tech Stack:** Node CJS, `pg`, Vitest vs Neon ci-perf-tests branch.
**Spec:** `docs/superpowers/specs/2026-06-01-exchange-market-clob-design.md`. **Builds on Plans 1–3.** Read Plan-1 "Seam contracts".

## Risk prices (Plan-1 `liquidation.js`)
For a position derive `side = shares>0?'buy':'sell'`, `entry = avg_entry`, and use the position's `leverage`. `mustLiquidate(position, mark, {leverage, maintenanceMargin})`. Mark = `markPrice(book, lastTrade)` (Plan-1). **Skip liquidation when shares===0.**

## Order-acceptance invariant (Plan-1 seam #6)
Reject an opening order whose computed liquidation price is already on the wrong side of entry (long: `liqPrice >= entry`; short: `liqPrice <= entry`) — happens at extreme leverage+extreme price.

---

### Task 1: Migration — position leverage, insurance seeding, raise max leverage default

**Files:** Create `db/migrations/012_exchange_leverage.sql`; Test `test/exchangeLeverageSchema.vitest.js`.

- [ ] **Step 1: Migration:**

```sql
-- Leverage support: per-position leverage, default max_leverage 10, insurance pool seeding helper.
BEGIN;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS leverage integer NOT NULL DEFAULT 1 CHECK (leverage BETWEEN 1 AND 10);
ALTER TABLE market_exchange_config ALTER COLUMN max_leverage SET DEFAULT 10;
COMMIT;
```

- [ ] **Step 2: Apply to both branches** (`npm run migrate`; `node --env-file=.env.test.local server/migrations/run_migrations.js`).
- [ ] **Step 3–4: Test** that `positions.leverage` exists (default 1) and `market_exchange_config.max_leverage` default is now 10 (information_schema check, `afterAll(pool.end())`). Run it.
- [ ] **Step 5: Commit** `feat(exchange): position leverage column + raise max leverage default`.

---

### Task 2: Margin-model account helpers

**Files:** Rewrite `server/exchange/accounts.js`; add `server/exchange/positionMargin.js`; update/replace `test/exchangeAccounts.vitest.js`.

**Design:**
- `positionMargin(position)` (pure, in `positionMargin.js`): `requiredMargin({ side: position.shares>0?'buy':'sell', price: position.avgEntry, qty: Math.abs(position.shares), leverage: position.leverage })`; 0 when shares===0. Round.
- `availableCash(userId, q)` rewritten: `starting + Σledger − Σ positions.margin_posted (this user, all markets) − Σ open-order escrow`, where open-order escrow = `Σ requiredMargin(side, price, remaining_qty, leverage)` over the user's open/partial orders. Because escrow now depends on side/price/leverage per order, compute it in SQL: for buys `ceil(price*remaining/leverage)`, for sells `ceil((100-price)*remaining/leverage)`.
- `sellableShares` is REMOVED/retired (humans may now short); replace its role with the order-acceptance margin check.

- [ ] TDD: write tests for `positionMargin` (long, short, flat) and the new `availableCash` (with a levered long position margin + a resting short order escrow). Then implement. Update any references. Run. Commit `feat(exchange): margin-model account helpers`.

---

### Task 3: Executor — margin model, human shorting + leverage

**Files:** Rewrite the accounting in `server/exchange/executor.js`; update `test/exchangeExecutor.vitest.js`; this also affects `test/exchangeBotAccount.vitest.js`, `test/exchangeBotDriver.vitest.js`, `test/exchangeState.vitest.js`, `test/exchangeRequoteWiring.vitest.js`, `test/exchangeCancel.vitest.js` (which asserted cash-model balances) — update their assertions to the margin model.

**Design (placeOrder):**
- Input adds `leverage` (default 1; validate `1 ≤ leverage ≤ market_exchange_config.max_leverage`; bot path may pass any ≤10).
- Validation (replaces the long-only check): compute the order's required margin = `requiredMargin(side, price, qty, leverage)`. Reject if `> availableCash` → `insufficient_margin`. **Humans may now sell to open shorts** — remove `short_not_allowed` for humans (keep `allowShort` only as the bot's cash/margin-exempt + invariant-exempt flag). Apply the **order-acceptance invariant** (reject `liqPrice` past `entry`) for the resulting position direction at this leverage.
- Per fill: update positions via `applyFill`; set the position's `leverage` (use the incoming order's leverage for the taker side; the maker keeps its resting order's leverage — store leverage on the position when opening/adding). Recompute `margin_posted = positionMargin(position)`. Realize P&L delta on reductions → `ledger_entries('realized_pnl', round(Δrealized))`. **No buy_fill/sell_fill ledger entries.** Trade-tape insert unchanged. Keep the Plan-2 self-trade fix.
- Persist position with `leverage` and `margin_posted`.

- [ ] TDD: rewrite executor tests for the margin model: opening a levered long locks `ceil(p*q/L)` margin (not full premium); opening a short locks `ceil((100-p)*q/L)`; closing realizes P&L to ledger; available reflects margin not premium; `insufficient_margin` when margin > available; humans CAN short now; the order-acceptance invariant rejects a degenerate high-leverage order. Implement. Run executor + all dependent suites (update their assertions). Commit `feat(exchange): margin-model executor with leverage and human shorting`.

---

### Task 4: Settlement — margin-model P&L + margin release + insurance reconciliation

**Files:** Create `db/migrations/013_exchange_settlement_margin.sql` (CREATE OR REPLACE `market_resolve_exchange`); update `test/exchangeSettlement.vitest.js` and `test/exchangeResolveHandler.vitest.js` assertions.

**Design:** keep the resolution-claim idempotency gate (Plan-3 fix). Change the settlement INSERT to `delta = (v_terminal − avg_entry) * shares` for positions with `shares <> 0` (round if needed — avg_entry is numeric, so cast: `round((v_terminal - avg_entry) * shares)`). After settlement, positions' margin is conceptually released (available recomputes since the market is resolved — but `availableCash` counts margin of OPEN positions; define "open" as positions in non-resolved markets, OR zero out `margin_posted`/`shares` for resolved markets in the RPC). Simplest: in the RPC, after booking settlement P&L, `UPDATE positions SET margin_posted=0 WHERE market_id=p_market_id` so released margin frees `availableCash`. Insurance pool reconciliation stays minimal in Plan 4 (liquidation handles its own; see Task 6).

- [ ] TDD: settlement books `(terminal-entry)*shares`; assert the CONSERVATION invariant `Σ(realized_pnl + settlement)` over all market participants = 0 (in a simple open-then-settle test with matched entries, settlement-alone also nets 0 — assert that there); margin released (availableCash rises post-resolution); idempotent (double-resolve no-op). Update the resolveHandler test's expected `my_delta`. Apply migration to both branches. Run. Commit.

---

### Task 5: Liquidation engine (mark-to-market, controlled)

**Files:** Create `server/exchange/liquidationDriver.js`; Test `test/exchangeLiquidation.integration.vitest.js`.

**Design:** `runLiquidations(marketId, deps)`:
1. Load book + last trade → `mark = markPrice(...)`.
2. Load all open positions (`shares <> 0`) with their `avg_entry`, `leverage`.
3. For each, `side/entry` derived; if `mustLiquidate(pos, mark, {leverage, maintenanceMargin})` → liquidate (controlled): submit a reduce order via `placeOrder` with `allowShort:true` (reduce-only: a long liquidation is a SELL of |shares|, a short liquidation is a BUY of |shares|), priced as a marketable limit **capped at the bankruptcy price** (so it can't fill worse than bankruptcy), against the bot's standing quotes. If it can't fully fill within the cap, the shortfall is covered by the **insurance pool** (debit insurance_pool.balance, credit the liquidated user so they don't go negative).
4. Runs after trades (the order handler already requotes; add a liquidation sweep there too, best-effort) and via a cron endpoint.

- [ ] TDD (integration): open a high-leverage long against the bot, push the mark down (place trades that lower the bot's quotes / a large sell) until the position crosses its liquidation price, run `runLiquidations`, assert the position is closed/reduced and the user's balance never goes negative. Implement. Run. Commit `feat(exchange): mark-price controlled liquidation engine`.

---

### Task 6: Insurance pool seeding + wiring + liquidation/cron endpoints

**Files:** `server/exchange/insurance.js` (seed + debit/credit helpers), seed on exchange-market creation, `pages/api/markets/[id]/liquidate.js` (cron/manual), wire a best-effort liquidation sweep into the order POST handler after requote. Expose `leverage` in the POST body validation and add `liquidationPrice`/`bankruptcyPrice`/`marginPosted`/`unrealizedPnl` (at mark) to `getExchangeState`.

- [ ] TDD where practical; `node --check` API files; update `exchangeState` test for the new fields. Commit `feat(exchange): insurance pool, liquidation endpoint, leverage in API + risk fields in state`.

---

### Task 7: Full suite green
- [ ] `npm run test:perf` (all suites, including the REWORKED plan-2/3 tests) + `npm test` (quick path) — all pass. `git status` clean.

---

## Notes for Plan 5 (UX)
- `getExchangeState` now returns `mark`, book ladder, `myPosition` (shares, avgEntry, marginPosted, unrealizedPnl, **liquidationPrice, bankruptcyPrice**), `myOpenOrders`, lastTrade. The UI (Layout C) renders price+chart, ticket with leverage control, book/position/trades tabs, and shows liquidation price calmly.
- Order POST body: `{ side, price, qty, type, leverage }`.
