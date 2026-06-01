# Exchange Markets — CLOB with Leverage (Design Spec)

**Date:** 2026-06-01
**Status:** Approved design, pre-implementation
**Author:** Michael Feng (with Claude)

## Summary

Add a new **Exchange** market type alongside the existing **Quick bet** market.
An Exchange market is a futures-style **central limit order book (CLOB)** on a binary
contract, with first-class shorting and **isolated-margin leverage up to 10×**
(auto-liquidation, insurance pool). Liquidity is guaranteed by an **automated bot
market maker** that quotes both sides, and humans can post their own limit orders.
Stakes remain **points, never real money**.

This is a deliberate move toward "feel like a real exchange" (Polymarket/Kalshi).
It is the one area the brand (`PRODUCT.md`) warns against (crypto/degen, predatory
staking), so the *mechanics* are hardcore but the *presentation* stays calm — no
liquidation theatrics, no manufactured urgency, risk shown plainly.

## Goals

- Primary: the **experience** of a real exchange — order book, bids/asks, market makers (#4).
- Live price that reacts to flow (#1), trade in/out before resolution (#2), better
  payouts for the unpopular side (#3) — all fall out of the CLOB naturally.
- Stay solvent: **no account balance ever goes negative.**
- Keep the existing Quick bet flow untouched.

## Non-goals (v1)

- Real money. Points only.
- Cross-margin (isolated only).
- Funding rates (dated future, not perpetual — expires to 0/100 at resolution).
- Dispute flows and void/N-A resolutions (creator resolves YES or NO, as today).
- Websockets (polling only).

## Decisions log (from brainstorming)

| Decision | Choice |
|---|---|
| Primary motivation | Realism (#4); live price / trade in-out / lopsided payouts are core UX |
| Market makers | **Both** — bot guarantees liquidity, humans can post limit orders |
| Scope | **New market type** alongside Quick bet (both coexist; page branches on `mechanism`) |
| Price mechanism | **CLOB** — price *is* the book (best bid/ask, last trade); not an AMM |
| v1 scope | **Full book** — matching engine, partial fills, cancels, escrow |
| Bot strategy | **Inventory-skew quoter** + **hard inventory caps** |
| Contract | YES share settles 100 / NO settles 0; prices **1–99¢**; **signed positions** |
| Shorting | **First-class** (required for humans to quote the ask side) |
| Leverage | **Yes** — isolated margin, up to **10×**, auto-liquidation, insurance pool |
| Margin model | Futures-style mark-to-market |
| Margin re-validation | At **both** placement **and** fill (resting orders re-checked at fill) |
| Risk prices | **Liquidation price** *and* **bankruptcy price** per position |
| Liquidation execution | **Controlled** (partial-first, priced limit capped at bankruptcy, staged) — never a naked market order |
| Mark price | **Clamped book mid**, not last trade; last trade is display-only |
| Fair value | Starts at creator seed, **converges fully to market discovery** (seed weight → 0) |
| Resolution | Creator-driven YES/NO, new atomic RPC `market_resolve_exchange` |
| Real-time | Polling (~2–3s) via existing `shouldPoll` discipline; no websockets |
| UX layout | **Hybrid (Layout C)** — big price + chart, real ticket with inline leverage, book/position/trades in tabs |

## The contract & trading model

- One binary contract per market. **YES share → 100 points if YES, 0 if NO.** NO is the mirror.
- Prices quoted in **cents 1–99**, which read as probability ("YES at 63¢" ≈ 63%).
- A user's net position is **signed** (positive = net long YES, negative = net short YES).
- Single underlying order book in **YES cents**; the NO side is the same book viewed as `100 − YES`.
- Actions: **Buy** (open/add long), **Sell** (reduce/close long; sell beyond holdings opens a short).
  "Buy NO" / "short YES" are the same book order viewed from the other side.
- Every match = **signed-position change + a cash leg** (no special mint/transfer branches in accounting).
  A long and a short opening against each other together escrow the full **100/share payout pool**
  (`buyer p` + `seller (100−p)` = 100), so unlevered trades are self-funding and points are conserved.

## Leverage & margin (futures model)

Treat the binary contract as a **dated future on a 0–100 underlying**:

- Long YES = long the future; short YES = short it.
- Marks continuously 1–99¢; **expires to terminal mark 100 or 0** at resolution.
- **Isolated margin** per position. Required margin = `max_loss ÷ leverage`, where
  max-loss/share = `price` (long) or `100 − price` (short).
- At L×, each side posts only its fraction; the system **fronts** the rest of the 100 pool.
  That fronted gap is what liquidation defends and the insurance pool backstops.

### Two risk prices per position

- **Liquidation price** — mark at which *maintenance* margin is breached → liquidation triggers (equity still positive).
- **Bankruptcy price** — mark at which equity hits **zero**; sits beyond the liquidation price.
  - Long at `p`, leverage `L`: bankruptcy ≈ `p·(1 − 1/L)`; liquidation = bankruptcy + maintenance buffer.
  - Short at `p`: bankruptcy ≈ `p + (100−p)/L`; liquidation = bankruptcy − maintenance buffer.
  - Close **better** than bankruptcy → surplus margin flows **into** insurance pool.
    Close **worse** → insurance pool **covers** the deficit.

### Controlled liquidation (never a naked market order)

When mark crosses the liquidation price:
1. **Partial-first** — reduce only enough to restore a safe maintenance level when sufficient.
2. **Priced & staged** — submit a limit order **capped at the bankruptcy price**, sliced for large
   positions to avoid self-impact / cascades. Engine effectively takes over the position at bankruptcy price.
3. **Escalation** — if unfilled in a short window, step toward/through bankruptcy and lean on the
   bot's standing quote as final counterparty.

### Solvency guarantee

Balances never go negative. If an extreme gap exhausts the insurance pool (controlled liquidation is
designed to prevent this), the residual deficit is absorbed and **logged** rather than pushing any
account below zero — acceptable because these are points.

## Mark price

- **Mark = book mid `(best bid + best ask)/2`, clamped within the bid/ask band.** Used for all
  unrealized P&L and liquidation. Manipulation-resistant because the bot always quotes two-sided.
- **Last trade price is display-only** (the tape); feeds nothing risk-related.
- If the book goes one-sided, mark falls back to the best available quote, not the last print.

## Bot market maker

- Pure quoter: `(fairValue, inventory, spread, ladderParams) → desiredOrders[]`.
- **Fair value** starts at the creator's seed probability, then blends `(1−w)·mark + w·seed`
  with seed weight `w → 0` as cumulative volume / elapsed time grows — **fully converging to
  market discovery**. Seed only bootstraps quoting when there is zero flow.
- Posts a **ladder** of bids/asks around fair value at a configured spread.
- **Inventory skew** — long YES ⇒ lower prices to shed risk; short ⇒ raise.
- **Hard inventory caps** (`max_inventory`, ±N) — at the cap, withdraw the accumulating side entirely;
  only quote the reducing side until inventory mean-reverts.
- **Interaction note:** the bot is also the liquidation backstop. If pinned at its inventory cap on the
  side a liquidation needs, it cannot absorb it — load shifts to humans + insurance pool + bankruptcy-price
  takeover. This is *why* the bankruptcy/insurance machinery must exist rather than relying on the bot alone.
- Bot driver re-quotes (cancel stale + post fresh) after any fill touching the bot, plus on a cron.

## Architecture (components)

**Pure core (DB-free, exhaustively unit-tested, mirrors `lib/predictionForm.js` style):**
1. **Matching engine** — `(incomingOrder, bookSnapshot) → { fills, residualOrder }`; price-time priority.
   Each fill is a `(price, qty, makerOrderId)`; mint-vs-transfer is *not* a branch here — it falls out
   of signed-position accounting in the executor (a fill against an opening short increases open interest,
   a fill against a closing long transfers it; the matcher doesn't care).
2. **Margin/escrow calculator** — `(side, price, qty, leverage, position) → { initialMargin, maxLoss, available_ok }`.
3. **Liquidation math** — `(position, mark) → { liquidationPrice, bankruptcyPrice, marginRatio, mustLiquidate, plan }`.
4. **Bot quoter** — `(fairValue, inventory, spread, ladderParams) → desiredOrders[]`.
5. **Mark price** — `(bookSnapshot, lastTrade) → mark`.

**Stateful layer (thin, transactional):**
6. **Trade executor** — wraps matching + escrow + position/ledger writes in one transaction,
   serialized per market via Postgres **advisory lock keyed on market_id**. Re-validates margin at fill.
7. **Bot driver** — calls quoter, cancels/re-posts bot orders. Inline after-fill + cron.
8. **Liquidation driver** — marks open positions to **mark price**, runs controlled liquidation on breaches;
   shortfalls drawn from insurance pool. Inline after-trade + cron safety sweep.
9. **Settlement** — `market_resolve_exchange` RPC.

**Edges:** API endpoints, polling, UX.

## Data model

- `markets.mechanism text DEFAULT 'quick'` — `'quick'` | `'exchange'`.
- `market_exchange_config` — `(market_id, seed_price, max_leverage, tick, maintenance_margin,
  bot_spread, bot_ladder, bot_max_inventory, ...)`.
- `orders` — `id, market_id, user_id (bot = per-market system account), side (buy|sell), price (1–99),
  quantity, filled_quantity, leverage, status (open|partial|filled|cancelled|liquidation),
  sequence (time priority), created_at`.
- `trades` — `id, market_id, price, quantity, taker_order_id, maker_order_id, taker_user, maker_user, created_at` (the tape).
- `positions` — `(market_id, user_id) → signed_shares, margin_posted, avg_entry, realized_pnl, updated_at`.
- `insurance_pool` — app-seeded points absorbing liquidation shortfalls; ending balance per market
  recorded as the market's **net subsidy**.
- Escrow/margin flow through `ledger_entries` with reasons:
  `order_escrow, escrow_release, fill, realized_pnl, liquidation, settlement, insurance`.
  Available balance = `starting + Σledger − open-order escrow − margin posted`.

## API & real-time

**Mutations:**
- `POST /api/markets/[id]/orders` — `{ side, outcome, type: limit|market, price?, qty, leverage }`.
  Idempotency-keyed (cf. `stablePredictionKey`). After-fill hooks (bot re-quote + liquidation re-check)
  run **inline** in the transaction. Returns fills + position + resting remainder.
- `DELETE /api/markets/[id]/orders/[orderId]` — cancel, release escrow.

**Read (one aggregated endpoint for polling):**
- `GET /api/markets/[id]/exchange-state` — book ladder (merged), mark, last trade, spread,
  my position (signed shares, avg entry, margin, unrealized P&L, **liquidation + bankruptcy price**),
  my open orders, recent trades. Parallel-fetched like `server/queries/marketDetail.js`.

`GET /api/markets/[id]` extended with `mechanism`. `POST .../resolve` branches by mechanism.

**Background:** Vercel cron for bot fair-value drift / re-quote and a safety liquidation sweep.
**Real-time:** polling ~2–3s via `shouldPoll` (visible tab, not mid-entry). No websockets in v1.

## Resolution / settlement

`market_resolve_exchange` (atomic, idempotent, creator-authorized, one resolution per market):
1. Cancel all open orders (human + bot), release escrow; cancel in-flight liquidations.
2. Expire contract to terminal mark (YES → 100, NO → 0).
3. Settle every position: `realized P&L = (terminal − avg_entry) × signed_shares`; release margin;
   net through `ledger_entries` (reason `settlement`).
4. Settle the bot the same way (net loss = app subsidy; profit → insurance pool).
5. Reconcile insurance pool; record ending balance as the market's **net subsidy** (= 0 for a
   no-leverage, no-bad-debt market).

## UX (Hybrid / Layout C)

- Top: question, **big mark price (¢)**, price chart.
- **Order ticket** (default tab): YES/NO toggle, amount, **inline leverage** (default 1×),
  limit/market switch. Market buy = one tap; limit/short = same ticket.
- Tabs: **Book** (merged depth ladder), **Position**, **Trades** (tape).
- **Position panel** shows risk *calmly*: signed shares, avg entry, unrealized P&L at mark,
  **liquidation + bankruptcy price** stated plainly. No theatrics, no urgency (brand guardrail).
- **Never encode YES/NO by color alone** — always label + position (WCAG 1.4.1).
- Quick bet markets keep today's one-tap UI; page branches on `mechanism`.
- Follow `DESIGN.md` (Playful-Modern; tabular-nums for prices; refs Manifold/Metaculus/PredictIt).

## Testing strategy

- **Pure-module unit tests (bulk):** matching (price-time priority, partial fills, residual resting),
  margin/escrow, mark-price (mid clamp, one-sided fallback), liquidation math (liquidation +
  bankruptcy, both sides, all leverage), bot quoter (skew, hard caps, fair-value convergence).
- **Transactional integration tests** (Neon test branch, cf. `resolve.integration.test.js`):
  concurrent orders racing the book under the per-market lock, escrow round-trips on cancel,
  fill-time margin re-validation, controlled-liquidation staging, settlement P&L + insurance
  reconciliation + solvency invariant.
- **Invariants:** points conserved up to recorded net subsidy; open interest balanced; no negative balances.

## Suggested build order (internal phasing of one spec)

1. Schema + `mechanism` branch + pure margin/mark/matching modules (unit-tested).
2. Trade executor + escrow + positions (no leverage yet) + book/order/cancel API.
3. Bot quoter + driver (liquidity + live price working end-to-end).
4. Leverage + liquidation math + controlled liquidation driver + insurance pool.
5. `market_resolve_exchange` settlement + invariants.
6. UX (Layout C) + polling.
