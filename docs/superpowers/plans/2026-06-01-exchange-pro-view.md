# Exchange Pro View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Add a Pro toggle to the exchange detail page that swaps the calm Layout C for a chart-first trading view with four switchable panels (Price chart via `lightweight-charts`, Depth split bot/human, Bot status, Events), backed by an extended `exchange-state` and a new `/history` endpoint.

**Architecture:** Pure view logic in `lib/proView.js` (unit-tested). Backend: extend `getExchangeState` (bot/human book split, a `bot` object, recent orders) + new `getMarketHistory` (`GET /history`). Frontend: `components/ProMarketView.jsx` (+ `PriceChart`, `DepthChart`, `BotStatus`, `EventFeed`) and a Pro toggle in `ExchangeMarket.jsx`. Calm Layout C untouched; toggle defaults off (localStorage).

**Tech Stack:** Next.js 14 / React 18, `lightweight-charts` (new dep, browser-only), Vitest, `pg`.
**Spec:** `docs/superpowers/specs/2026-06-01-exchange-pro-view-design.md`. Builds on the exchange feature (`server/exchange/*`, `components/ExchangeMarket.jsx`, `lib/exchangeView.js`).

**Shapes (keep exact across tasks):**
- History: `{ prices:[{at, price}], botBand:[{at, bid, ask}], botMarkers:[{at, price, side}] }`.
- Extended `exchange-state` adds: `book.bids/asks` entries gain `botQty`; `bot: { inventory, fairValue, bestBid, bestAsk, spread, maxInventory, capUsedPct }`; `recentOrders:[{id, isBot, side, price, qty, status, at}]`.

---

### Task 1: `lib/proView.js` pure helpers

**Files:** Create `lib/proView.js`; Test `test/proView.vitest.js`.

- [ ] **Step 1: Write the failing test** — Create `test/proView.vitest.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { toUnixSeconds, priceSeries, depthRows, botStatusLines, eventFeed } from '../lib/proView.js';

describe('toUnixSeconds', () => {
  it('converts ms numbers, ISO strings, and Date to integer seconds', () => {
    expect(toUnixSeconds(1700000000000)).toBe(1700000000);
    expect(toUnixSeconds('2023-11-14T22:13:20.000Z')).toBe(1700000000);
    expect(toUnixSeconds(new Date(1700000000000))).toBe(1700000000);
  });
});

describe('priceSeries', () => {
  const history = {
    prices: [{ at: 1700000000000, price: 60 }, { at: 1700000060000, price: 63 }],
    botBand: [{ at: 1700000000000, bid: 58, ask: 62 }],
    botMarkers: [{ at: 1700000060000, price: 63, side: 'sell' }],
  };
  it('builds ascending {time,value} line/bid/ask series', () => {
    const s = priceSeries(history);
    expect(s.line).toEqual([{ time: 1700000000, value: 60 }, { time: 1700000060, value: 63 }]);
    expect(s.bid).toEqual([{ time: 1700000000, value: 58 }]);
    expect(s.ask).toEqual([{ time: 1700000000, value: 62 }]);
  });
  it('maps bot markers (sell=above/arrowDown, buy=below/arrowUp)', () => {
    const m = priceSeries(history).markers[0];
    expect(m.time).toBe(1700000060);
    expect(m.position).toBe('aboveBar');
    expect(m.shape).toBe('arrowDown');
  });
  it('dedupes equal timestamps keeping the last (lightweight-charts needs unique ascending times)', () => {
    const s = priceSeries({ prices: [{ at: 1000, price: 1 }, { at: 1000, price: 2 }], botBand: [], botMarkers: [] });
    expect(s.line).toEqual([{ time: 1, value: 2 }]);
  });
});

describe('depthRows', () => {
  it('accumulates from the mid outward and splits bot depth', () => {
    const book = {
      bids: [{ price: 62, qty: 5, botQty: 5 }, { price: 60, qty: 10, botQty: 4 }],
      asks: [{ price: 64, qty: 4, botQty: 4 }, { price: 66, qty: 6, botQty: 0 }],
    };
    const d = depthRows(book);
    // bids: best (62) first, cumulative outward
    expect(d.bids.map((r) => [r.price, r.cum, r.cumBot])).toEqual([[62, 5, 5], [60, 15, 9]]);
    expect(d.asks.map((r) => [r.price, r.cum, r.cumBot])).toEqual([[64, 4, 4], [66, 10, 4]]);
    expect(d.maxCum).toBe(15);
  });
});

describe('botStatusLines', () => {
  it('labels a long inventory and cap usage', () => {
    const s = botStatusLines({ inventory: 120, fairValue: 61, bestBid: 59, bestAsk: 63, spread: 4, maxInventory: 500, capUsedPct: 24 });
    expect(s.inventoryLabel).toBe('+120 YES');
    expect(s.quoteLabel).toBe('59¢ / 63¢');
    expect(s.spreadLabel).toBe('4¢ spread');
    expect(s.capLabel).toBe('120 / 500');
    expect(s.capPct).toBe(24);
  });
  it('labels short and flat', () => {
    expect(botStatusLines({ inventory: -40, maxInventory: 500 }).inventoryLabel).toBe('-40 short');
    expect(botStatusLines({ inventory: 0, maxInventory: 500 }).inventoryLabel).toBe('flat');
  });
});

describe('eventFeed', () => {
  const BOT = 'bot:m1';
  it('shows trades as fills and collapses a bot re-quote batch into one row', () => {
    const trades = [{ price: 63, qty: 4, at: 1700000060000 }];
    const recentOrders = [
      { id: 'o1', isBot: true, side: 'buy', price: 58, qty: 50, status: 'cancelled', at: 1700000000000 },
      { id: 'o2', isBot: true, side: 'sell', price: 62, qty: 50, status: 'cancelled', at: 1700000000000 },
      { id: 'o3', isBot: true, side: 'buy', price: 59, qty: 50, status: 'open', at: 1700000050000 },
      { id: 'o4', isBot: true, side: 'sell', price: 63, qty: 50, status: 'open', at: 1700000050000 },
      { id: 'h1', isBot: false, side: 'buy', price: 60, qty: 10, status: 'open', at: 1700000055000 },
    ];
    const rows = eventFeed(recentOrders, trades, { limit: 10 });
    // one fill row, two collapsed bot re-quote rows (one per batch ts), one human place row
    const kinds = rows.map((r) => r.kind);
    expect(kinds.filter((k) => k === 'fill').length).toBe(1);
    expect(kinds.filter((k) => k === 'bot_requote').length).toBe(2);
    expect(kinds.filter((k) => k === 'human_order').length).toBe(1);
    // newest first
    expect(rows[0].at >= rows[rows.length - 1].at).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify FAIL:** `npx vitest run test/proView.vitest.js`

- [ ] **Step 3: Implement `lib/proView.js`** (ESM). Logic:
  - `toUnixSeconds(at)`: `Math.floor(new Date(at).getTime() / 1000)`.
  - `priceSeries({prices, botBand, botMarkers})`: map each to `{time: toUnixSeconds(at), value/...}`; sort ascending by time; **dedupe equal times keeping last** (build a Map keyed by time). `line` from prices, `bid`/`ask` from botBand, `markers` from botMarkers → `{ time, position: side==='sell'?'aboveBar':'belowBar', color: '#00C2A8', shape: side==='sell'?'arrowDown':'arrowUp', text: '' }`.
  - `depthRows({bids, asks})`: bids sorted price desc, asks price asc; running `cum` and `cumBot` from the inside outward; return `{ bids:[{price,qty,botQty,cum,cumBot}], asks:[...], maxCum }` where `maxCum = max(last bid cum, last ask cum)`.
  - `botStatusLines(bot)`: `inventoryLabel` = `bot.inventory>0?`+${inv} YES`:bot.inventory<0?`${inv} short`:'flat'` (note short uses the negative number as-is, e.g. `-40 short`); `quoteLabel` = `${bestBid}¢ / ${bestAsk}¢` (or '—' if null); `spreadLabel` = `${spread}¢ spread`; `capLabel` = `${Math.abs(inventory)} / ${maxInventory}`; `capPct` = `bot.capUsedPct`. Guard nulls.
  - `eventFeed(recentOrders, trades, {limit=20})`: produce rows. Trades → `{kind:'fill', at:+at, label:`Filled ${qty} @ ${price}¢`}`. Group **bot** orders by `at` (same timestamp = one re-quote batch) → one `{kind:'bot_requote', at:+at, label:`Bot re-quoted around ${mid}¢`}` per batch (mid = round((maxBotBid+minBotAsk)/2) for that batch, else the batch's avg price). Human orders → `{kind:'human_order', at:+at, label:`${status} ${side} ${qty} @ ${price}¢`}` each. Merge all, sort by `at` descending, slice to `limit`. (`+at` via `new Date(at).getTime()`.)

- [ ] **Step 4: Run, verify all pass:** `npx vitest run test/proView.vitest.js`
- [ ] **Step 5: Commit:** `git add lib/proView.js test/proView.vitest.js && git commit -m "feat(pro): pure pro-view helpers (series, depth, bot status, event feed)"`

---

### Task 2: Extend `getExchangeState` (bot/human book split, bot object, recent orders)

**Files:** Modify `server/exchange/exchangeState.js`; Test: extend `test/exchangeState.vitest.js`.

- [ ] **Step 1: Add to the test** `test/exchangeState.vitest.js` (read it first; it already sets up a market with bot via the existing flow — ensure a bot exists by importing `ensureBot`/`requoteBot` if not already). New assertions after fetching state:
  - `state.book.asks[0]` has a numeric `botQty`.
  - `state.bot` exists with numeric `inventory`, `maxInventory`, and `capUsedPct`, and `bestBid`/`bestAsk` numbers (or null) and `spread`.
  - `Array.isArray(state.recentOrders)` and each entry has `isBot` boolean + `status`.

- [ ] **Step 2: Implement.** In `server/exchange/exchangeState.js`:
  - Import `botUserId` from `./botAccount`, `convergedFairValue` from `./botQuoter`.
  - Change `ladder(orders, botId)` to also sum bot qty: `{ price, qty, botQty }` where `botQty` sums orders whose `userId === botId`. (`loadBook` returns orders with `userId`, `side`, `price`, `qty` — but the current `ladder` is called with `book.bids`/`book.asks` which ARE the per-order arrays from `loadBook`; confirm `loadBook` returns per-order objects there — it does. Pass `botId`.)
  - Add to the `Promise.all`: bot position (`SELECT shares FROM positions WHERE market_id=$1 AND user_id=$2` with botId), config (`SELECT seed_price, bot_max_inventory, maintenance_margin FROM market_exchange_config WHERE market_id=$1` — replaces the maintenance-only query), volume (`SELECT COALESCE(SUM(quantity),0)::int v FROM trades WHERE market_id=$1`), recent orders (`SELECT id, user_id, side, price, (quantity-filled_quantity) AS qty, status, created_at FROM orders WHERE market_id=$1 ORDER BY created_at DESC LIMIT 40`).
  - Build `bot`: `inventory` = bot shares (0 if none); `fairValue = Math.round(convergedFairValue({ seed: cfg.seed_price, mark: mark ?? cfg.seed_price, volume, scale: 1000 }))`; `bestBid` = max price among bot bids in the book (or null); `bestAsk` = min price among bot asks (or null); `spread` = (bestBid!=null && bestAsk!=null) ? bestAsk-bestBid : null; `maxInventory = cfg.bot_max_inventory`; `capUsedPct = Math.round(100*Math.abs(inventory)/maxInventory)`.
  - `recentOrders` = rows mapped to `{ id, isBot: user_id===botId, side, price, qty, status, at: created_at }`.
  - Return the existing object plus `bot` and `recentOrders` (book entries now include `botQty`). Keep `maintenanceMargin` logic working from the merged config query.

- [ ] **Step 3: Run** `npx vitest run test/exchangeState.vitest.js` → pass. Then `npm run test:perf` → green (the existing UI reads book `{price,qty}` — adding `botQty` is additive and non-breaking).
- [ ] **Step 4: Commit:** `git add server/exchange/exchangeState.js test/exchangeState.vitest.js && git commit -m "feat(pro): bot/human book split + bot object + recent orders in exchange-state"`

---

### Task 3: `getMarketHistory` + `GET /history`

**Files:** Create `server/exchange/marketHistory.js`; Create `pages/api/markets/[id]/history.js`; Test `test/exchangeHistory.vitest.js`.

- [ ] **Step 1: Write the test** `test/exchangeHistory.vitest.js`: set up a market, `ensureBot`, `requoteBot` (creates a bot ladder), do a crossing trade (bot fills a human), `requoteBot` again (cancels old ladder → those become cancelled bot orders), then:
  - `const h = await getMarketHistory(marketId, query);`
  - assert `Array.isArray(h.prices)` and `h.prices.length >= 1` with `{at, price}`;
  - assert `Array.isArray(h.botBand)` and at least one `{at, bid, ask}` with `bid < ask`;
  - assert `Array.isArray(h.botMarkers)` (the bot was a counterparty on the crossing trade, so `>= 1`), each `{at, price, side}`.

- [ ] **Step 2: Implement `server/exchange/marketHistory.js`:**

```javascript
// Time-series for the Pro price chart. prices = trade prints; botBand = the bot's
// best bid/ask reconstructed per re-quote batch from the orders table (including
// cancelled orders — the bot cancels+reposts its whole ladder each re-quote, and
// each batch shares a created_at, so grouping by created_at yields one band sample
// per re-quote). botMarkers = trades where the bot was a counterparty, with side.
const { query: defaultQuery } = require('../db');
const { botUserId } = require('./botAccount');

async function getMarketHistory(marketId, q = defaultQuery) {
  const bot = botUserId(marketId);
  const [pricesRes, botOrdersRes, markersRes] = await Promise.all([
    q(`SELECT price, created_at AS at FROM trades WHERE market_id=$1 ORDER BY created_at ASC LIMIT 500`, [marketId]),
    q(`SELECT side, price, created_at AS at FROM orders WHERE market_id=$1 AND user_id=$2 ORDER BY created_at ASC`, [marketId, bot]),
    q(`SELECT t.price, t.created_at AS at,
              o.side AS side
       FROM trades t
       JOIN orders o ON o.id = CASE WHEN t.taker_user=$2 THEN t.taker_order_id
                                    WHEN t.maker_user=$2 THEN t.maker_order_id END
       WHERE t.market_id=$1 AND ($2 IN (t.taker_user, t.maker_user))
       ORDER BY t.created_at ASC LIMIT 500`, [marketId, bot]),
  ]);

  // Group bot orders by created_at batch -> one {at, bid, ask} per re-quote.
  const byBatch = new Map();
  for (const r of botOrdersRes.rows) {
    const key = new Date(r.at).getTime();
    if (!byBatch.has(key)) byBatch.set(key, { at: r.at, bids: [], asks: [] });
    (r.side === 'buy' ? byBatch.get(key).bids : byBatch.get(key).asks).push(r.price);
  }
  const botBand = [...byBatch.values()]
    .map((b) => ({ at: b.at, bid: b.bids.length ? Math.max(...b.bids) : null, ask: b.asks.length ? Math.min(...b.asks) : null }))
    .filter((b) => b.bid !== null && b.ask !== null);

  return {
    prices: pricesRes.rows.map((r) => ({ at: r.at, price: r.price })),
    botBand,
    botMarkers: markersRes.rows.map((r) => ({ at: r.at, price: r.price, side: r.side })),
  };
}

module.exports = { getMarketHistory };
```

- [ ] **Step 3: Create `pages/api/markets/[id]/history.js`** — GET only, authenticated + group-membership (mirror `pages/api/markets/[id]/exchange-state.js` exactly): return `getMarketHistory(req.query.id, query)` as JSON 200; 401/403/405 as that handler does. `node --check` it.
- [ ] **Step 4: Run** `npx vitest run test/exchangeHistory.vitest.js` → pass; `npm run test:perf` → green.
- [ ] **Step 5: Commit:** `git add server/exchange/marketHistory.js "pages/api/markets/[id]/history.js" test/exchangeHistory.vitest.js && git commit -m "feat(pro): market history endpoint (price series + bot band + markers)"`

---

### Task 4: `ProMarketView` + sub-components + Pro toggle + lightweight-charts

**Files:** Create `components/ProMarketView.jsx`; Modify `components/ExchangeMarket.jsx`; add `lightweight-charts` dependency; styles per `DESIGN.md`.

- [ ] **Step 1: Add the dependency:** `npm install lightweight-charts` (record it in `package.json`).
- [ ] **Step 2: Read** `components/ExchangeMarket.jsx`, `lib/proView.js`, `lib/exchangeView.js`, `DESIGN.md`, and `pages/api/markets/[id]/exchange-state.js` for the fetch/poll pattern.
- [ ] **Step 3: Build `components/ProMarketView.jsx`** (props `{ marketId, market }`):
  - Poll `GET /exchange-state` (~2500ms, guarded by `shouldPoll(document.hidden, false)`); fetch `GET /history` once on mount (and on a slow ~15s refresh) for the chart.
  - **View switcher** (radio/tab group, arrow-key nav): Price (default) · Depth · Bot · Events. Only the active panel mounts.
  - `PriceChart`: dynamic `import('lightweight-charts')` inside `useEffect`; create chart on a container ref; add a line series (`priceSeries(history).line`), two faint line series for `bid`/`ask` band, and `setMarkers(priceSeries(history).markers)`; `ResizeObserver` for sizing; `chart.remove()` on cleanup; disable animations for `prefers-reduced-motion`. `aria-label` on the container with the current price.
  - `DepthChart`: SVG from `depthRows(state.book)`; bids left, asks right; each bar stacked bot (teal `#00C2A8`) vs human (neutral) using `cum`/`cumBot` scaled by `maxCum`.
  - `BotStatus`: render `botStatusLines(state.bot)` as a calm key-value strip + a small cap-usage bar (`capPct`).
  - `EventFeed`: `eventFeed(state.recentOrders, state.trades, { limit: 20 })` as a list.
  - **Compact order ticket** docked below the chart (reuse the ticket logic from `ExchangeMarket.jsx`/`lib/exchangeView.js` — extract a shared `OrderTicket` if it reduces duplication, else a slimmed inline copy) + best bid/ask readout.
- [ ] **Step 4: Add the Pro toggle to `components/ExchangeMarket.jsx`:** a `role="switch"` control in the header; state initialized from `localStorage.getItem('betcha.proView') === '1'`; on change persist and swap the body — `pro ? <ProMarketView .../> : <existing calm body>`. The calm body markup is unchanged; only conditionally rendered.
- [ ] **Step 5: Verify build:** `npx next build 2>&1 | tail -25` compiles the markets route (and `lightweight-charts` resolves). If full build is slow/unrelated-failing, `node --check` the changed JS and confirm no import/JSX errors in the additions.
- [ ] **Step 6: Commit:** `git add -A components/ ExchangeMarket package.json package-lock.json 2>/dev/null; git add -A && git commit -m "feat(pro): Pro trading view (chart, depth, bot status, events) + toggle"`

---

### Task 5: Full suite + build green
- [ ] `npm run test:perf` (incl. `proView`, extended `exchangeState`, `exchangeHistory`) + `npm test` — all pass.
- [ ] `npx next build` — succeeds.
- [ ] `git status` — clean.

---

## Notes
- The bot band reconstruction relies on each re-quote batch sharing a `created_at`; if future bot changes stagger quote timestamps, group by a small time bucket instead.
- Default OFF keeps casual users on calm Layout C; Pro is per-device via localStorage (no schema change).
