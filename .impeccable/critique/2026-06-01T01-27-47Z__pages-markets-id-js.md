---
target: pages/markets/[id].js
total_score: 19
p0_count: 2
p1_count: 2
timestamp: 2026-06-01T01-27-47Z
slug: pages-markets-id-js
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | "Last updated" shows, but no pending/loading state on Yes/No; you tap, nothing visible, then a hard reload. Polling has no indicator. |
| 2 | Match System / Real World | 3 | Right vocabulary (YES/NO, Stake, Balance, Odds), but raw lowercase `market.state` ("open") and "total_delta"/"resolution reason" leak system language. |
| 3 | User Control and Freedom | 1 | No way to change or cancel a prediction once placed; the input section disappears. No undo on a points-staking action; no pre-commit confirm. |
| 4 | Consistency and Standards | 1 | Defined `.button-predict-active`, `.resolution-outcome`, `.choice-yes/no` classes unused; equivalents reinvented inline. Errors via `alert()` while `.message.error` exists. Two vocabularies. |
| 5 | Error Prevention | 1 | Stake input accepts 0/negative/over-balance client-side; server rejects via alert. No confirm on irreversible stake or on resolve (which moves everyone's points). |
| 6 | Recognition Rather Than Recall | 3 | Balance shown near stake; choice echoed in a pill. But resolve section doesn't repeat the market title for context. |
| 7 | Flexibility and Efficiency | 2 | No Enter-to-submit on stake or chat; no quick-stake presets (25/50/Max) for the mobile audience. |
| 8 | Aesthetic and Minimalist Design | 3 | Hero + odds bar are clean and on-brand; dragged down by inline-style clutter and an always-expanded resolve form. |
| 9 | Error Recovery | 1 | Errors are dead-end `alert()`s with raw text; image-upload failure is silent (console only). No retry anywhere. |
| 10 | Help and Documentation | 2 | Support chatbot exists but scoped only to "writing a resolve reason" (and hardcodes `outcome:true`). No help for first-timers; no empty-state teaching. |
| **Total** | | **19/40** | **Poor — core interaction integrity needs work; visual shell is fine.** |

## Anti-Patterns Verdict

**LLM assessment:** A competent, on-brand visual *shell* wrapped around an unfinished, inconsistent *core interaction*. The hero, animated odds bar, layout-matched skeleton, and the resolution/end state are genuinely good. But the moment you place a bet, the seams show: the stylesheet's best-designed component (`.button-predict-active`, the selected-state pop) is **never rendered** — the buttons just disappear after predicting (line 312); error handling is native `alert()` (lines 91/175/189) or silent (image upload, 135); the primary action ends in a hard `router.reload()` (line 94). Default glassmorphism is present (`.market-detail-hero`: `rgba(255,255,255,0.72)` + `backdrop-filter: blur(20px)`), used as the hero's whole identity. Inline-style sprawl with magic hex values duplicates classes that already exist. These are AI-slop tells: styled states the markup never reaches, two sources of truth drifting.

**Deterministic scan (detect.mjs):**
- `pages/markets/[id].js` (markup): **clean, 0 findings.** No shared-ban violations (no gradient text, side-stripes, eyebrow stacks, identical card grids). Agrees with the manual markup read.
- `styles/globals.css`: **5 findings (exit 2).** 4× `overused-font` (Geist, lines 426/601/728/936, warning) — but DESIGN.md deliberately specifies Geist for tabular data, so this is a defensible committed choice, not slop. 1× `layout-transition` (line 706, `transition: width` on the odds bar) — a real catch the manual review rated as a *strength*: the effect (animated fill conveying state) is right, but animating `width` is jank-prone; reconcile by switching to `transform: scaleX`.

**Visual overlays:** Not available. No browser automation in this environment, so no live `[Human]` overlay tab was injected. Findings are from source review + the deterministic detector only (fallback signal).

## Overall Impression
Strong start, strong end, hollow and slightly anxious middle — exactly where money/points and social standing are on the line. The single biggest opportunity: finish the core bet-placement interaction (persistent selected state, inline/branded errors, optimistic update instead of reload, a pre-commit confirm) so the most important moment stops being the quietest, least-designed one.

## What's Working
1. **Layout-matched skeleton** (lines 207–227): placeholder blocks mirror the real title/odds/button geometry. The correct pattern (skeleton, not spinner), on-brand, sets honest expectations.
2. **The resolution/end state** (lines 373–458): outcome banner + personal points delta + winner roster + native share. Directly serves the product's core job ("settle it and rib each other") and surfaces the people — "social, not solitary."
3. **The odds bar** (CSS 696–744): dual-color, percentage + raw count + side label, animated fill. Legible at the moment of decision, avoids the "wall of numbers" anti-reference. (Effect is good; see detector note on the `width` technique.)

## Priority Issues

**[P0] Yes/No relies on color+position; selected state never renders; no pre-commit confirm.** The buttons carry text labels (so not a pure 1.4.1 color-alone failure), but the defined `.button-predict-active` selected state is never applied and the buttons vanish after predicting, so the control keeps no record of the choice. Odds percentages and chips lean on green/red with no icon. No confirmation before staking points. *Why it matters:* PRODUCT.md mandates WCAG 1.4.1 and "legible at the moment of decision"; a colorblind or distracted user can stake on the wrong side with no safety net. *Fix:* add check/cross icons to each side; apply `.button-predict-active` and keep the chosen button visible+disabled after predicting; add an inline "Stake 100 on YES — confirm" step. *Command:* `/impeccable harden`.

**[P0] Errors use `alert()` or fail silently; no recovery.** Lines 91/175/189 throw native `alert()`; image upload (135) only `console.error`s. *Why it matters:* heuristics 1/4/9 all fail here; a blocking OS dialog (or silence) at a failed money/points action is the loudest off-brand artifact in the file. *Fix:* render the existing `.message.error`/`.message.success` components inline near the control, with retry; map "insufficient points" to a friendly specific message. *Command:* `/impeccable harden`.

**[P1] Hard `router.reload()` after the primary action** (lines 94, 187). *Why it matters:* violates the explicit "fast and lightweight … near-instant" principle; re-runs skeleton + float-in, loses scroll/focus, blinks the whole app after every bet. *Fix:* optimistically update local state (`setMyPrediction`, bump counts, set balance) and re-run `fetchPredictionStats()` — no navigation. *Command:* `/impeccable optimize` (with `animate` for the optimistic transition).

**[P1] Creator sees predict + resolve at once; resolve is destructive and unconfirmed** (lines 312–371). Nine actionable controls visible simultaneously for the creator; resolve buttons fire on a single tap. *Why it matters:* cognitive-load items 1/5/6/8 fail; declaring a winner moves everyone's points irreversibly with no confirm. *Fix:* collapse resolve behind a "Resolve this market" disclosure with a summarizing confirm ("Resolve YES — settles all 8 stakes"). *Command:* `/impeccable layout` (with `harden` for the confirm).

**[P2] Stake input + 5s polling friction.** Stake `onChange` (323) bypasses min/max (0/negative/over-balance allowed), no `inputMode="numeric"`, no presets, no Enter-to-submit, error only via server alert. Polling `setInterval(…,5000)` (line 34) has no `document.hidden` guard (runs in background tabs), no indicator, and silently mutates counts → odds bar re-animates and content shifts mid-interaction; `aria-live="polite"` re-announces every tick. *Fix:* clamp `[1,balance]` on change, add `inputMode="numeric"` + quick-stake chips + Enter-submit + inline validation; gate polling on visibility and pause while the stake field is focused. *Commands:* `/impeccable clarify` + `/impeccable optimize`.

## Persona Red Flags

**Sam (accessibility / keyboard / screen reader)** — most critical. No `:focus-visible` on any button (`.button`, `.button-predict`, `.button-ghost`, FAB, Send) — only inputs get a focus ring (CSS 236); direct WCAG 2.4.7 + PRODUCT.md "visible focus states" failure. Odds percentages colored green/red with no non-color cue (CSS 738–744). `aria-live="polite"` on the odds block re-announces every 5s poll. Image-upload progress/failure not announced.

**Casey (distracted, one-handed mobile)** — the stated audience. Hard `router.reload()` on a flaky connection = blank + skeleton flash after every bet (high mid-conversation abandonment). No quick-stake presets means summoning the numeric keyboard one-handed for every bet. A failed bet throws a full-screen `alert()` — maximal interruption for the most interruption-prone user. Bottom-nav tap targets (~38px) and the `padding:0` "Back to Group" button are sub-44px.

**Riley (stress tester / edge cases).** Stake 0/negative/`1e9` pass client-side (only server stops them, via alert). No empty state for a brand-new market ("Be the first to predict"); defaults silently to 50/50. Winner with no `display_name` falls back to a raw UUID (line 431) → overflows the chip row on mobile. `handleShare` calls `navigator.share` without an existence check → desktop "Share Result" likely throws instead of using the clipboard fallback. Idempotency key uses `Date.now()` (line 80) → two fast taps generate different keys → possible double prediction.

**Devin, the group-chat instigator** (project-specific). No share/invite on an *open* market — share only appears after resolution (line 451), so the social-acquisition loop is missing exactly where it drives the game. Raw `market.state` text and "Resolution reason" labels read like admin tooling, off the "talk smack" brand voice. Declaring a winner (the most socially charged action) has no ceremony and no broadcast to the group.

## Minor Observations
- `.resolution-outcome` (753), `.button-predict-active` (800), and the entire `.predictions-list/.prediction-item/.choice-*/.result-*` block (828–887) are defined but unused — dead or unfinished. There's no rendered list of who predicted what, despite the styling existing.
- Support chatbot hardcodes `outcome: true` (line 162) → wrong advice for NO resolutions; its help is scoped to creators only.
- `market.state` rendered as a raw lowercase enum (line 264).
- Geist (detector `overused-font`) is a deliberate DESIGN.md choice for tabular data — keep, but worth a conscious confirm.
- `transition: width` (CSS 706) → switch to `transform: scaleX` to keep the odds-bar animation off the layout path.

## Questions to Consider
1. Why does the best-designed component in your stylesheet (the active Yes/No state) never appear on screen — should placing a bet remove the controls, or *become* them?
2. At the one moment points and pride are on the line, why is the interface at its quietest (silent POST + hard reload) while the *outcome* screen gets all the celebration?
3. This is sold as a multiplayer, group-chat product — so why can't I pull a friend into a *live* market from this page, and why does sharing only exist after it's already over?
