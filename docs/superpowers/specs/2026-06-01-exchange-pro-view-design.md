# Exchange Pro View — Trading Chart + Bot Visibility (Design Spec)

**Date:** 2026-06-01
**Status:** Approved design, pre-implementation
**Author:** Michael Feng (with Claude)

## Summary

Add a **Pro view** to the exchange market-detail page: a chart-first trading layout, reached via a **Pro toggle**, that makes the bot market maker's behavior visible. Pro mode offers four switchable views — a **price chart** (TradingView `lightweight-charts`) with the bot's bid/ask band and trade markers, a **depth chart** split by bot-vs-human liquidity, a **bot status strip**, and an **events feed**. Calm Layout C remains the default and is untouched.

This realizes the spec's long-stated north star: calm-by-default, power-view-on-toggle.

## Goals
- Let a user *see the bot acting* — its quotes over time, its trades, its share of the book, its inventory.
- Provide a real trading-chart experience (crosshair, pan/zoom) without heavy custom work.
- Keep the casual one-tap experience the default and unchanged.

## Non-goals
- No server-side persistence of the Pro preference (localStorage, per-device).
- No new charting beyond the price view's library (depth is hand-rolled SVG; status/events are DOM).
- No realtime transport change (polling stays).

## Decisions (from brainstorming)
| Decision | Choice |
|---|---|
| Views in Pro | **All four**, switchable: Price chart, Depth, Bot status, Events |
| Price charting | **TradingView `lightweight-charts`** (first chart dep); depth = hand-rolled SVG; status/events = DOM |
| Toggle UX | **Full swap** — Pro replaces calm Layout C's body; header + toggle persist |
| Default | **Off** (calm); preference persisted in `localStorage` (`betcha.proView`) |
| Realtime | Poll `exchange-state` (~2.5s, `shouldPoll`) for Depth/Bot/Events; fetch `history` on open, append on poll |

## Architecture

**New units:**
- `lib/proView.js` (ESM, pure, unit-tested) — series shaping for the price chart, depth-row computation split bot/human, bot-status formatting, event-feed summarization.
- `components/ProMarketView.jsx` — the dense chart-first layout: chart area + view switcher (Price · Depth · Bot · Events) + compact order ticket + best bid/ask. Sub-components: `PriceChart` (lightweight-charts), `DepthChart` (SVG), `BotStatus`, `EventFeed`.
- `components/ExchangeMarket.jsx` — gains the **Pro toggle** swapping calm Layout C ↔ `ProMarketView`.

**Backend additions (additive, no destructive changes):**
1. Extend `server/exchange/exchangeState.js` `getExchangeState` with:
   - **book levels tagged bot vs human** quantity (`loadBook` already has `user_id`; split by `bot:<marketId>`),
   - a **`bot` object**: `{ inventory (signed shares), fairValue, bestBid, bestAsk, spread, maxInventory, capUsedPct }`,
   - **recent order events** (last ~20: `{ type: 'place'|'cancel'|'fill', side, price, qty, user, isBot, at }`).
2. New `server/exchange/marketHistory.js` `getMarketHistory(marketId, q)` + `GET /api/markets/[id]/history`:
   - **price series** from `trades` (`{ at, price }`),
   - **bot bid/ask band over time** reconstructed from `orders WHERE user_id = bot:<marketId>` **including cancelled** orders (their `created_at`/`price`/`status` form an audit log of every quote — no new logging needed),
   - **bot trade markers** (trades where taker/maker = bot, with side).

**Data flow:** Pro view polls `exchange-state` for Depth/Bot/Events (live, cheap); fetches `history` once on open and appends new trade prints to the chart via `chart.update()`. History is its own endpoint (not in the poll) because it is large and slow-changing.

## The four views

**A · Price chart (`lightweight-charts`).** Price line/area over time; overlaid faint **bot bid/ask band** (two line series from the reconstructed bot-quote history); **series markers** (▲ buy / ▼ sell) where the bot was a trade counterparty. Crosshair + pan/zoom from the lib. New prints appended via `update()`.

**B · Depth chart (SVG).** Cumulative staircase from the current book — bids descending left of mid, asks ascending right — each level **stacked bot (teal) vs human (neutral)** so the bot's share of the book is visible.

**C · Bot status strip (DOM).** Calm key-value readout: signed **inventory** ("+120 YES" / "−40 short"), **fair value**, **best bid/ask + spread**, **inventory-cap usage** (small bar, "120 / 500"). No chart, no alarm styling.

**D · Events feed (DOM list).** Recent activity. The bot re-quotes on every fill (cancel + repost its ladder), so the feed **collapses a bot cancel-and-repost into one line** ("Bot re-quoted around 63¢"); human places/cancels/fills and all trades show individually. This summarization is a pure function in `lib/proView.js` (tested).

The switcher is a chip row (Price default). Only the active view mounts/subscribes; the chart is torn down when not shown.

## Pro toggle, chart integration, persistence

- **Toggle:** a `role="switch"` Pro control in the header. ON renders `ProMarketView` instead of calm Layout C's body; OFF renders calm. Header + toggle persist across the swap. The compact ticket lives inside `ProMarketView`.
- **Persistence:** `localStorage` `betcha.proView`; read on mount; default off.
- **lightweight-charts:** browser-only — loaded via dynamic `import()` inside `useEffect` (no SSR). Lifecycle: create on container ref → `setData(history)` → `update()` per poll → `chart.remove()` on unmount/view-switch. `ResizeObserver` for sizing. `prefers-reduced-motion` disables easing.
- **Brand/a11y:** DESIGN.md tokens (teal `#00C2A8` bot/positive, neutral human, primary `#FF5A5F` active toggle/chip, error `#E84D4D`); tabular-nums; switch + radio/tab view-switcher keyboard-operable with arrow-key nav; chart container `aria-label` summarizes current price (canvas decorative to AT).

## Testing

- **Pure `lib/proView.js` (Vitest):** price/band series shaping; depth rows split bot/human with correct cumulative depth; bot-status formatting (signed inventory, cap %, spread); **event summarization** (bot cancel+repost → one row; humans + trades individual).
- **Backend integration (Vitest vs ci-perf-tests):** extended `getExchangeState` (bot/human-split levels, `bot` object, events); `getMarketHistory` (price series + reconstructed band from trades + cancelled bot orders).
- **UI:** build-verified (`next build`) + reasoned; all logic in the tested pure helpers.
- **No regressions:** `npm run test:perf` + `npm test` + `next build` green; calm Layout C untouched (toggle defaults off).

## Suggested build order
1. `lib/proView.js` pure helpers + tests.
2. Backend: extend `getExchangeState` (bot/human split, `bot` object, events) + tests.
3. Backend: `getMarketHistory` + `GET /history` + tests.
4. `ProMarketView` + sub-components + the Pro toggle in `ExchangeMarket.jsx`; add `lightweight-charts`; build-verify.
5. Full suite + build green.
