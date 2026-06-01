# Exchange Market UX — Layout C (Plan 5 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Ship the exchange market-detail surface (Layout C: big price + chart, an order ticket with an inline leverage control, and Book / Position / Trades tabs with a calm risk display), plus the ability to create an Exchange market alongside Quick bet.

**Architecture:** Testable view logic lives in pure `lib/exchangeView.js` (unit-tested with Vitest, like `lib/predictionForm.js`). The detail page `pages/markets/[id].js` branches on `market.mechanism`: `'quick'` keeps today's one-tap UI untouched; `'exchange'` renders the exchange view, which polls `GET /api/markets/[id]/exchange-state` (reusing the `shouldPoll` discipline), posts via `POST /orders`, and cancels via `DELETE /orders/[orderId]`. Market creation gains a Quick/Exchange choice. Follow `DESIGN.md` (Playful-Modern, tabular-nums for prices, never encode YES/NO by color alone).

**Tech Stack:** Next.js 14 (pages router), React 18, Vitest. Read `DESIGN.md` and `PRODUCT.md` before any visual work.
**Spec:** `docs/superpowers/specs/2026-06-01-exchange-market-clob-design.md`. **Builds on Plans 1–4.** `GET /exchange-state` returns `{ book:{bids,asks}, mark, lastTrade, myPosition:{shares,avgEntry,realizedPnl,marginPosted,leverage,unrealizedPnl,liquidationPrice,bankruptcyPrice}, myOpenOrders }`. Order POST body: `{ side, price, qty, type, leverage }`.

---

### Task 1: Pure exchange-view helpers

**Files:** Create `lib/exchangeView.js`; Test `test/exchangeView.vitest.js`.

- [ ] **Step 1: Write the failing test** — Create `test/exchangeView.vitest.js`:

```javascript
import { describe, it, expect } from 'vitest';
import {
  formatCents, probabilityLabel, ladderRows, leveragePresets,
  ticketValidationMessage, exchangeOrderErrorMessage, positionSummary, placeOrderBody,
} from '../lib/exchangeView.js';

describe('formatCents', () => {
  it('renders an integer cent price with the ¢ suffix', () => {
    expect(formatCents(63)).toBe('63¢');
  });
  it('rounds a fractional mark to the nearest cent', () => {
    expect(formatCents(62.5)).toBe('63¢');
    expect(formatCents(null)).toBe('—');
  });
});

describe('probabilityLabel', () => {
  it('reads a YES price as a probability phrase', () => {
    expect(probabilityLabel(63)).toBe('63% YES');
    expect(probabilityLabel(null)).toBe('No price yet');
  });
});

describe('ladderRows', () => {
  it('returns asks high→low then bids high→low with cumulative depth, capped at maxLevels each', () => {
    const book = { bids: [{ price: 62, qty: 5 }, { price: 60, qty: 10 }], asks: [{ price: 64, qty: 4 }, { price: 66, qty: 6 }] };
    const rows = ladderRows(book, 2);
    // asks shown high price first (66 then 64), bids high first (62 then 60)
    expect(rows.asks.map((r) => r.price)).toEqual([66, 64]);
    expect(rows.bids.map((r) => r.price)).toEqual([62, 60]);
    // cumulative depth from the inside of the book outward
    expect(rows.asks.find((r) => r.price === 64).cumulative).toBe(4);
    expect(rows.asks.find((r) => r.price === 66).cumulative).toBe(10);
  });
});

describe('leveragePresets', () => {
  it('offers 1x..maxLeverage from a standard set', () => {
    expect(leveragePresets(10)).toEqual([1, 2, 5, 10]);
    expect(leveragePresets(3)).toEqual([1, 2, 3]);
    expect(leveragePresets(1)).toEqual([1]);
  });
});

describe('ticketValidationMessage', () => {
  it('is empty for a valid limit order within balance', () => {
    expect(ticketValidationMessage({ type: 'limit', price: 60, qty: 10, leverage: 1, available: 1000 })).toBe('');
  });
  it('flags qty < 1', () => {
    expect(ticketValidationMessage({ type: 'limit', price: 60, qty: 0, leverage: 1, available: 1000 })).toBe('Enter a quantity of at least 1.');
  });
  it('flags a price outside 1..99 for limit orders', () => {
    expect(ticketValidationMessage({ type: 'limit', price: 0, qty: 5, leverage: 1, available: 1000 })).toBe('Price must be between 1¢ and 99¢.');
  });
  it('flags margin exceeding available balance (long, leverage divides cost)', () => {
    // long 100 @ 60, lev 1 => margin 6000 > 1000
    expect(ticketValidationMessage({ type: 'limit', side: 'buy', price: 60, qty: 100, leverage: 1, available: 1000 }))
      .toBe("That needs 6000 points of margin — you have 1000.");
  });
  it('lets leverage reduce the required margin below the balance', () => {
    // long 100 @ 60, lev 10 => margin 600 <= 1000
    expect(ticketValidationMessage({ type: 'limit', side: 'buy', price: 60, qty: 100, leverage: 10, available: 1000 })).toBe('');
  });
});

describe('exchangeOrderErrorMessage', () => {
  it('maps insufficient_margin to a friendly line', () => {
    expect(exchangeOrderErrorMessage(400, { error: 'insufficient_margin' })).toBe("Not enough points for that margin. Lower the size or raise leverage.");
  });
  it('maps leverage_too_high', () => {
    expect(exchangeOrderErrorMessage(400, { error: 'leverage_too_high' })).toBe('That leverage is too high for this price. Lower it.');
  });
  it('falls back for unknown errors', () => {
    expect(exchangeOrderErrorMessage(500, {})).toBe("Couldn't place your order. Try again.");
  });
});

describe('positionSummary', () => {
  it('summarizes a long with calm risk labels', () => {
    const s = positionSummary({ shares: 10, avgEntry: 60, leverage: 2, unrealizedPnl: 40, liquidationPrice: 33 });
    expect(s.sideLabel).toBe('Long YES');
    expect(s.sharesLabel).toBe('10 shares @ 60¢');
    expect(s.leverageLabel).toBe('2×');
    expect(s.pnlLabel).toBe('+40');
    expect(s.liquidationLabel).toBe('Liq 33¢');
  });
  it('summarizes a short and a flat position', () => {
    expect(positionSummary({ shares: -5, avgEntry: 40, leverage: 1, unrealizedPnl: -10, liquidationPrice: 99 }).sideLabel).toBe('Short YES');
    expect(positionSummary({ shares: 0 }).sideLabel).toBe('No position');
  });
});

describe('placeOrderBody', () => {
  it('builds the POST body from ticket state', () => {
    expect(placeOrderBody({ side: 'buy', type: 'limit', price: 63, qty: 10, leverage: 2 }))
      .toEqual({ side: 'buy', type: 'limit', price: 63, qty: 10, leverage: 2 });
  });
  it('omits price for a market order', () => {
    expect(placeOrderBody({ side: 'sell', type: 'market', qty: 5, leverage: 1 }))
      .toEqual({ side: 'sell', type: 'market', price: null, qty: 5, leverage: 1 });
  });
});
```

- [ ] **Step 2: Run, verify FAIL:** `npx vitest run test/exchangeView.vitest.js`

- [ ] **Step 3: Implement `lib/exchangeView.js`** (ESM, like `lib/predictionForm.js`). Match every test exactly. Key logic:
  - `formatCents(p)` → `p == null ? '—' : Math.round(p) + '¢'`.
  - `probabilityLabel(p)` → `p == null ? 'No price yet' : Math.round(p) + '% YES'`.
  - `ladderRows(book, maxLevels)` → asks sorted ascending then take inside-out cumulative, but DISPLAY high→low: compute cumulative from best ask (lowest) outward, then reverse for display; bids sorted descending, cumulative from best bid (highest) outward; cap each side to `maxLevels`.
  - `leveragePresets(max)` → `[1,2,5,10].filter(v => v <= max)`, and ensure `max` itself is included if not already and ≤10 (for the given tests `[1,2,5,10]` and `[1,2,3]` — so: take `[1,2,5,10]` filtered ≤max, then if max not in it and max>1 add max, sort; verify against tests: max3 → [1,2] + 3 → [1,2,3] ✓; max10 → [1,2,5,10] ✓; max1 → [1] ✓).
  - `ticketValidationMessage({type, side, price, qty, leverage, available})` → qty<1 msg; for limit price∉[1,99] msg; compute margin = `Math.ceil((side==='buy'? price : 100-price) * qty / leverage)` (for limit; for market estimate with price given or skip), if margin>available → `That needs ${margin} points of margin — you have ${available}.`; else ''.
  - `exchangeOrderErrorMessage(status, payload)` → map `insufficient_margin`, `leverage_too_high`, `short_not_allowed` (shouldn't happen now), `market_not_open`, `invalid_leverage`, 401→session expired; fallback "Couldn't place your order. Try again."
  - `positionSummary(pos)` → flat when `!pos || pos.shares===0` (`sideLabel:'No position'`); else Long/Short YES labels, `${|shares|} shares @ ${round(avgEntry)}¢`, `${leverage}×`, signed pnl (`+40`/`-10`), `Liq ${round(liquidationPrice)}¢`.
  - `placeOrderBody(t)` → `{ side, type, price: type==='market'? null : t.price, qty, leverage }`.

- [ ] **Step 4: Run, verify ALL pass:** `npx vitest run test/exchangeView.vitest.js`
- [ ] **Step 5: Commit** `feat(exchange): pure exchange-view helpers`.

---

### Task 2: Create an Exchange market (endpoint + create UI)

**Files:** Modify `pages/api/markets/index.js` (accept `mechanism` + `seed_price`); modify the market-creation UI (find it — likely in `pages/markets/index.js` or a create form/component); Test `test/exchangeCreateApi.vitest.js`.

- [ ] Read `pages/api/markets/index.js` and the create UI. In the POST `createMarket`, if `mechanism === 'exchange'`: call `createExchangeMarket({ groupId: group_id, creatorId: user.id, title, seedPrice: seed_price || 50 }, query)` (from `server/exchange/createMarket`, which already seeds config + insurance + you'll also call `ensureBot` + `requoteBot`), then best-effort `requoteBot(marketId, { getClient, query })` so the market opens with bot liquidity. Else keep the existing quick-market insert. Return the created market.
- [ ] Add a **Quick bet / Exchange** choice to the create UI (a segmented control), and when Exchange is selected, a starting-probability input (1–99, default 50). Keep it on-brand and simple. (Build-verified.)
- [ ] **Test** `test/exchangeCreateApi.vitest.js`: call the create handler (or the underlying create path) with `mechanism:'exchange'` and assert a market with `mechanism='exchange'`, a config row, an insurance_pool row, AND that the bot has posted a two-sided ladder (bot orders exist) after creation. (Model the handler invocation on how other API tests call handlers, or test the `createExchangeMarket`+`ensureBot`+`requoteBot` sequence directly if invoking the Next handler is awkward.)
- [ ] `node --check` the API file. Commit `feat(exchange): create Exchange markets with seeded bot liquidity`.

---

### Task 3: Exchange detail UI (Layout C) — branch `pages/markets/[id].js` on mechanism

**Files:** Modify `pages/markets/[id].js`; optionally add `components/ExchangeMarket.js` (or inline a component) to keep the page focused; styles per `DESIGN.md`.

- [ ] Read the full `pages/markets/[id].js` (≈686 lines) and `DESIGN.md` first. The page already fetches the market; branch on `market.mechanism`. For `'exchange'`, render the exchange view; leave the quick path untouched.
- [ ] **Exchange view (Layout C)** using `lib/exchangeView.js` helpers:
  - **Top:** market question; big mark price via `formatCents(mark)` + `probabilityLabel`; a lightweight price line/area from the trades tape (a simple inline SVG/sparkline is fine — no chart lib).
  - **Order ticket (default tab):** YES/NO side toggle (labelled, not color-only), amount (qty) input, an **inline leverage control** (`leveragePresets(maxLeverage)` chips, default 1×), a limit/market switch (limit shows a price input). Live `ticketValidationMessage` under the ticket. Submit → `POST /orders` with `placeOrderBody(...)` + an idempotency key (cf. `stablePredictionKey` style); on error show `exchangeOrderErrorMessage`.
  - **Tabs:** Book (depth ladder from `ladderRows`, asks above bids, with a mid/spread row), Position (`positionSummary` — shares, avg, leverage, unrealized P&L, **liquidation price** shown calmly, no alarmist styling), Trades (recent tape).
  - **My open orders:** list with a Cancel button → `DELETE /orders/[orderId]`.
  - **Polling:** poll `GET /exchange-state` every ~2.5s using the existing `shouldPoll(hidden, busy)` discipline (don't poll while the tab is hidden or mid-submit).
  - Honor `prefers-reduced-motion`; never encode YES/NO by color alone (label + position).
- [ ] **Verify:** `npx next build 2>&1 | tail -25` completes without errors for the markets route (or at minimum `node --check`/lint the changed files if the full build is slow/unrelated-failing). Manually reason through the data flow (state shape matches `getExchangeState`).
- [ ] Commit `feat(exchange): exchange market detail UI (Layout C)`.

---

### Task 4: Full suite + build green
- [ ] `npm run test:perf` (all suites incl. `exchangeView`) + `npm test` — all pass.
- [ ] `npx next build` — succeeds (no errors in the new/changed routes). If pre-existing unrelated build issues exist, confirm the exchange routes specifically compile.
- [ ] `git status` clean (only the pre-existing unrelated working-tree edits remain).

---

## Done = all 5 plans complete
After this plan: a full CLOB exchange market type — pure math core, transactional executor, bot market maker, settlement, leverage/shorting/liquidation/insurance, and the Layout-C UI — alongside the untouched Quick bet flow. Stakes remain points; balances never go negative.
