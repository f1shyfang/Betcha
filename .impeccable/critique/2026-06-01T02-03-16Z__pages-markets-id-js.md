---
target: pages/markets/[id].js
total_score: 33
p0_count: 0
p1_count: 2
timestamp: 2026-06-01T02-03-16Z
slug: pages-markets-id-js
---
## Design Health Score (re-score after P0–P2 fixes)

| # | Heuristic | Score | Δ | Key Issue |
|---|-----------|-------|---|-----------|
| 1 | Visibility of System Status | 4 | +2 | aria-live odds, optimistic update, Placing…/Resolving… states, balance shown. |
| 2 | Match System / Real World | 3 | +1 | "Open"/"Resolved" labels, no em dash. Resolved view still shows raw OUTCOME enum; settlement key replace('_') only first underscore. |
| 3 | User Control & Freedom | 4 | +2 | Pre-commit confirm + Cancel on both predict and resolve; no accidental commits. |
| 4 | Consistency & Standards | 3 | +1 | Confirm/preset patterns reused, global focus ring, choice-pill tokenized. Resolved-view chips still inline magic-hex. |
| 5 | Error Prevention | 4 | +2 | clampStake, stakeValidationMessage gates buttons, stable idempotency key, confirm step. |
| 6 | Recognition vs Recall | 3 | +1 | Confirm bar restates stake+side; pill persists; presets reduce recall. |
| 7 | Flexibility & Efficiency | 3 | +1 | Quick-stake presets + Max, Web Share + clipboard fallback. No share/invite on OPEN market. |
| 8 | Aesthetic & Minimalist | 3 | +1 | Creator no longer sees 9 controls (resolve collapsed). Resolved banner still busy. |
| 9 | Error Recovery | 4 | +3 | Inline .message.error role=alert, specific predictionErrorMessage, Retry, per-section state. No alert()/silent fail. |
| 10 | Help & Documentation | 2 | +1 | Support chatbot now sends the real outcome + gates on a chosen side, but still no empty/first-predictor guidance. |
| **Total** | | **33/40** | **+14** | **Good / production-acceptable** (was Poor / blocking). |

## Anti-Patterns Verdict
All 10 prior fixes CONFIRMED in code (not cosmetic): inline branded errors + retry, Yes/No icons + persisted active state + confirm, optimistic update (no router.reload), visibility-gated polling, resolve disclosure + summarizing confirm, stake clamp/presets/inputMode/validation, button focus-visible rings, navigator.share guard, friendly market.state label, no-em-dash share copy. Detector clean on the page markup. The introduced/known P0 (support chatbot hardcoded outcome:true) was fixed: it now sends the armed `pendingResolve` and requires the creator to pick a side first.

## What's Working
- The core bet-placement interaction is now trustworthy: arm → confirm, clamped/validated stake, optimistic update, idempotency, inline recoverable errors, color-independent Yes/No.
- Biggest movers: error recovery (+3), system status / control / error-prevention (+2 each) — exactly the targeted areas.

## Remaining Issues (deferred, not in this session's scope)
- **[P1] No share/invite on an OPEN market.** Share renders only in the resolved block; the social-acquisition loop is missing where it drives the game (`/impeccable craft` a live-market share). 
- **[P1] No empty / first-predictor state.** Zero predictions silently shows a 50/50 bar; add "Be the first to predict" (`/impeccable onboard`).
- **[P2] Resolved-view chips use inline magic-hex** duplicating `.choice-pill`/`.message`/tokens — DESIGN.md drift (`/impeccable polish` the resolved view).
- **[P2] odds-fill `transition: width`** (reduced-motion neutralizes it; default still animates layout) — `/impeccable animate`/`optimize`.
- **[P3] settlement key `replace('_',' ')`** only replaces first underscore; `market-pill` falls through to raw enum for unknown states; resolved `myStake` depends on `my_prediction` hydration.

## Verdict
Placing a prediction is now production-trustworthy. Remaining defects cluster in the resolve/resolved-view and social-loop paths, not in the core action.
