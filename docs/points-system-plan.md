<!-- /autoplan restore point: /Users/mf/.gstack/projects/hackerhouse/main-autoplan-restore-20260430-201415.md -->
# Points System Plan

## Goal
Implement a transparent, fair points system that rewards correct predictions, participation, and consistency so group competition feels meaningful.

## Current State
- Users can create markets, make predictions, and resolve outcomes.
- Leaderboard exists, but score mechanics are limited and not clearly tied to user actions.
- Resolution moment does not consistently show score delta.

## Proposed Scope

### 1) Scoring model
- Correct prediction: +5 points
- Incorrect prediction: -2 points
- Early participation bonus: +1 point if prediction is placed in the first 25% of market lifetime
- Creator stewardship bonus: +2 points to creator when market is resolved on time

### 2) Resolution score settlement
- On market resolution, compute score changes for every participant.
- Persist score ledger entries per user for auditability:
  - `user_id`
  - `market_id`
  - `group_id`
  - `delta`
  - `reason` (`correct`, `incorrect`, `early_bonus`, `creator_stewardship`)
  - `created_at`

### 3) Group leaderboard updates
- Leaderboard should aggregate from score ledger (source of truth), not ad-hoc counters.
- API should return:
  - total score
  - last 5 deltas
  - display name/email fallback

### 4) UI changes
- `markets/[id]`:
  - Show "You earned +N points" after resolution.
  - Show score breakdown chips by reason.
- `groups/[id]`:
  - Show leaderboard with trend arrow (up/down/flat) based on last 3 deltas.
  - Add tooltip explaining scoring rules.

### 5) Backfill + migration
- Create migration for `score_ledger` table.
- Backfill initial ledger entries from already resolved markets (best-effort; skip markets without complete prediction data).

### 6) Safety + idempotency
- Resolution settlement must be idempotent:
  - Re-running resolution should not duplicate ledger rows.
  - Use `(market_id, user_id, reason)` uniqueness guard where applicable.
- Add transaction boundaries so partial settlement cannot occur.

### 7) Tests
- Unit:
  - scoring math with edge cases (ties/no predictions/late resolutions)
- Integration:
  - resolve flow writes expected ledger rows
  - leaderboard endpoint aggregates correctly
  - idempotent re-resolution does not duplicate entries

## Out of Scope
- Cross-group global rankings
- Monetary rewards or wallet integration
- Season-based multipliers

## Risks
- Existing resolved market data may be incomplete for backfill.
- UI confusion if scoring rules are not visible at action points.
- Race conditions if resolve is called concurrently.

## Success Criteria
- Every resolved market creates a deterministic score settlement record.
- Users can explain why their score changed from UI alone.
- Leaderboard rank changes correlate with recent market outcomes.

## GSTACK REVIEW REPORT

### Phase 1 - CEO Review (SELECTIVE EXPANSION)
- Premises confirmed: fairness, transparency, and visible score causality are the right core problem for this product stage.
- What already exists:
  - `pages/api/markets/[id]/resolve.js` already enforces auth and idempotency key wiring.
  - `pages/api/groups/[id]/leaderboard.js` already computes leaderboard from ledger rows.
  - `pages/markets/[id].js` and `pages/groups/[id].js` already surface resolution and leaderboard UI sections.
- Dream-state delta:
  - Current: users see outcomes and rough score effects, but not a robust reasoned ledger model.
  - This plan: deterministic score ledger with explicit reasons and better UI explainability.
  - 12-month ideal: tunable season mechanics, streak systems, and trust-preserving anti-gaming controls.

#### Error & Rescue Registry
| Risk | User Impact | Rescue |
|---|---|---|
| Duplicate settlement writes | Inflated or inconsistent leaderboard | Unique constraints + idempotent resolve transaction |
| Backfill data gaps | Historical scores appear unfair | Best-effort backfill with audit flag for skipped markets |
| Ambiguous scoring visibility | Users distrust rank movement | Always render reasoned deltas at resolution + leaderboard tooltip |

#### Failure Modes Registry
| Failure mode | Severity | Coverage |
|---|---|---|
| Concurrent resolve calls | Critical | Must be transactionally idempotent |
| Missing prediction rows | High | Skip/flag during backfill |
| Partial settlement on server error | Critical | Atomic commit/rollback boundary |

#### CEO Dual Voices - Consensus
| Dimension | Claude | Codex | Consensus |
|---|---|---|---|
| Premises valid? | yes | yes | CONFIRMED |
| Right problem to solve? | yes | yes | CONFIRMED |
| Scope calibration correct? | yes | partial | DISAGREE |
| Alternatives sufficiently explored? | partial | partial | CONFIRMED (gap) |
| Competitive/market risks covered? | partial | yes | DISAGREE |
| 6-month trajectory sound? | yes | yes | CONFIRMED |

CEO concerns summary:
- Keep scope complete on trust-critical paths (settlement correctness + explainability), but defer season multipliers.
- Add anti-gaming guardrails to prevent creator/early bonus exploitation.

### Phase 2 - Design Review
- UI scope detected and reviewed.
- Positive: key surfaces are correctly targeted (`markets/[id]`, `groups/[id]`).
- Gap: scoring explanations need to be visible exactly at moments of uncertainty (after resolution, on leaderboard trend changes, and tooltip discoverability).

Design litmus scorecard:
| Dimension | Score |
|---|---|
| Information hierarchy | 8/10 |
| State completeness | 7/10 |
| UX specificity | 8/10 |
| Accessibility clarity | 6/10 |
| Responsive intent | 7/10 |
| Error state design | 6/10 |
| Visual consistency | 8/10 |

### Phase 3 - Engineering Review
- Architecture shape is sound: extend current resolve + leaderboard pipelines instead of introducing a second scoring system.
- Mandatory implementation direction:
  - Keep one source of truth ledger.
  - Resolve flow writes settlement entries exactly once.
  - Leaderboard reads aggregated deltas from ledger only.

#### Architecture ASCII Diagram
```text
markets/[id].js
   -> POST /api/markets/:id/resolve
      -> resolveHandler + idempotency
         -> score_ledger writes (transactional)
            -> groups/:id/leaderboard aggregation
               -> groups/[id].js leaderboard + trends
```

#### Test Diagram (codepath -> coverage)
| Codepath | Test Type | Status |
|---|---|---|
| resolve success writes score_ledger rows | integration | required |
| re-resolve with same idempotency key | integration | required |
| leaderboard aggregation across markets | integration | required |
| early bonus window math | unit | required |
| creator stewardship condition | unit | required |
| backfill skips incomplete records safely | integration | required |

Test plan artifact written:
- `/Users/mf/.gstack/projects/hackerhouse/mf-main-test-plan-20260430-201600.md`

### Phase 3.5 - DX Review
- DX scope detected because this affects API behavior and future maintainability.
- Score: 7/10.
- TTHW for future contributors (implement + validate points flow): current ~35 min -> target ~15 min with explicit endpoint contracts and fixture-driven tests.

DX implementation checklist:
- Document score reason enums and invariants.
- Return explicit score delta payload in resolve response.
- Add "problem + cause + fix" response messages for settlement failures.
- Include copy-paste local verification command sequence in README/TODOS follow-up.

### NOT in Scope (deferred to TODOS)
- Global cross-group rankings.
- Monetary incentives and wallet integration.
- Season multipliers and recurring cadence scoring.

### Cross-Phase Themes
- **Trust by explainability:** CEO, Design, and Eng all independently flagged that score changes must be user-legible in context.
- **Single source of truth:** CEO and Eng aligned that split scoring stores would create long-term inconsistency risk.

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| 1 | CEO | Keep points-system scope on fairness + explainability | Mechanical | P1 completeness | Matches current product trust gap directly | broad gamification first |
| 2 | CEO | Use existing resolve + leaderboard surfaces | Mechanical | P4 DRY | Reuses proven pathways in current codebase | parallel new scoring service |
| 3 | CEO | Defer season multipliers | Taste | P3 pragmatic | Not required for immediate pilot trust | add season complexity now |
| 4 | Design | Require score reason chips in market resolution UI | Mechanical | P5 explicit | Users need concrete reason labels, not hidden math | opaque aggregate-only score change |
| 5 | Design | Add leaderboard scoring tooltip | Mechanical | P1 completeness | Prevents confusion about rank movement | docs-only explanation |
| 6 | Eng | Keep settlement idempotent with uniqueness guard | Mechanical | P1 completeness | Prevents duplicate ledger writes under retries | best-effort no hard guard |
| 7 | Eng | Require transaction boundary for settlement | Mechanical | P5 explicit | Avoids partial updates and inconsistent totals | multi-step non-atomic writes |
| 8 | Eng | Backfill as best-effort with skip flags | Taste | P3 pragmatic | Preserves forward correctness without brittle migration | block release on perfect historical backfill |
| 9 | DX | Standardize score reason enum in API contract | Mechanical | P5 explicit | Lowers implementation ambiguity | infer reason strings ad hoc |
| 10 | DX | Defer advanced contributor tooling | Mechanical | P3 pragmatic | Keep delivery focused on product-critical scoring path | build scaffolding-heavy framework first |
