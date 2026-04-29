# Design: Betcha - Private Prediction Markets for Friends


Status: DRAFT


## Problem Statement
Build Betcha, a private prediction market for friends where ordinary life moments become fun and accountable through lightweight stakes. The app should adapt to both accountability-heavy contexts (gym consistency, roommate chores) and purely fun contexts (game night outcomes, social dares).

## What Makes This Cool
The core delight is social: "artificial stakes" that make people care more, joke more, and follow through. Betcha is not trying to be a public macro-prediction exchange; it is trying to turn friend-group moments into recurring rituals people talk about offline.

## Constraints
- First version must be usable fast for small friend groups.
- Private and invite-only by default.
- Must support both accountability and entertainment use cases.
- Keep regulatory complexity low in v1 by avoiding heavy-money infrastructure.
- Product should feel lightweight and social, not financial/enterprise.

## Premises
1. Betcha wins by friend-group accountability and fun, not global event breadth.
2. The first wedge is private invite-only recurring contexts (gym, chores, game night).
3. Launch should prioritize web plus invite-link distribution and defer complex regulated money rails until clear pull exists.

## Cross-Model Perspective

- Strongest extension idea is recurring "season" markets rather than one-off bets, so social narrative compounds over weeks.
- Most revealing user quote: "as there are artificial stakes involved". This indicates the product value is social game mechanics, not financial sophistication.
- Existing baseline that covers part of trust/social money behavior: Splitwise-style friend-group settlement patterns.
- Weekend prototype recommendation aligns with MVP scope: create market, invite friends, place predictions, resolve winner, payout/score, and share leaderboard.

## Approaches Considered
### Approach A: Fast MVP
Summary: Ship an invite-only web app with market creation, friend participation, manual resolution, and simple payout/score.
Effort: S
Risk: Low
Pros:
- Fastest route to real usage this week.
- Clean validation of whether friend groups actually repeat behavior.
- Lowest implementation complexity and easiest iteration path.
Cons:
- Limited differentiation unless social loop is polished.
- Manual resolution can create disputes.
- Fewer retention mechanics in initial version.
Reuses:
- Next.js + Supabase baseline patterns.
- Invite-link onboarding flows.
- Simple score ledger primitives.

### Approach B: Ideal Architecture
Summary: Build modular market engine with role permissions, settlement adapters, anti-abuse controls, and analytics.
Effort: XL
Risk: Med
Pros:
- Best long-term maintainability and feature extensibility.
- Better trust/integrity controls for growth.
- Cleaner base for optional real-money expansion later.
Cons:
- Overbuild risk before user pull is proven.
- Longer time-to-first-user feedback.
- More engineering overhead for a pre-validation stage.
Reuses:
- Domain-event and RBAC architecture patterns.
- Moderation and audit-log primitives.

### Approach C: Recurring Seasons Loop
Summary: Focus on recurring accountability seasons (e.g., 12-week gym season) with streaks and weekly resolves.
Effort: L
Risk: Med
Pros:
- Strong retention and identity formation in friend groups.
- Clear emotional differentiation from generic betting apps.
- Fits accountability use cases naturally.
Cons:
- Requires careful fairness and anti-gaming design.
- More product complexity than one-off market MVP.
- Slightly slower initial build than minimal scope.
Reuses:
- Habit tracker streak logic.
- Scheduled weekly settlement patterns.

## Recommended Approach
Choose Approach A now, then evolve into Approach C once baseline usage proves repeated engagement.

Rationale:
- You can validate the core behavior fast (do friends actually create, join, and resolve markets repeatedly?).
- It preserves option value: if recurrence appears naturally, add season mechanics quickly.
- It avoids locking into heavy architecture or regulated flows too early.
- V1 payout default: score-only ledger (no in-app real-money custody) to reduce legal and operational risk.

## Open Questions
- What is the dispute resolution fallback when market creator makes a biased resolution?
- Should invited users see all group markets by default or only explicit invites?

## Success Criteria
- 2-3 friend groups (6-10 total friends) complete at least 3 resolved markets each by day 14.
- At least 20% of participating users join a second market by day 14.
- At least 1 group requests a weekly accountability market template by day 14 (signal for Approach C, not required MVP feature).
- Median time from market creation to first friend participation is under 5 minutes.

## Distribution Plan
- Channel: mobile-first web app shared via invite links in existing group chats.
- Initial growth loop: market creator invites 3-10 friends directly; resolved markets include leaderboard screenshot/share card.
- Default starter template: gym accountability challenge (highest clarity and weekly repeat behavior).
- Deployment: Vercel for frontend/API and Supabase for data/auth.
- CI/CD: GitHub Actions for lint/test/build on pull requests, auto-deploy on main merge.

## Next Steps
1. Days 1-3: Build core data model (users, groups, markets, predictions, resolutions, ledger entries) and invite-link onboarding.
2. Days 4-6: Implement MVP flows (create market, join, place prediction, resolve outcome) plus a lightweight leaderboard/history view.
3. Day 3 gate: ship dispute fallback (majority vote tie-breaker with moderator override) before pilot invitations.
4. Days 7-14: Run pilot with 2-3 groups (6-10 total friends) across gym + chores + game-night scenarios.
5. Pilot ops owner: allocate at least 0.5 FTE for dispute handling, participant feedback, and outcome logging during days 7-14.
6. Day 14 review: measure repeat behavior and dispute frequency, then decide whether to add season mechanics.

## Pilot Execution Assignment
Run one real 14-day Betcha pilot with 2-3 friend groups (6-10 total friends) across at least two contexts (one accountability, one fun), assign one pilot lead, and document exactly where friction or disputes appear.

## Appendix: What I noticed about how you think
- You defined the emotional core directly: "make ordinary life fun".
- You framed mechanism clearly: "artificial stakes involved".
- You anchored early audience in real people and contexts: "aaryan and donald", gym accountability, roommate chores.
- You stated differentiation in human terms: "making the ordinary extraordinary".

## Reviewer Concerns
- Data model details should be explicitly documented before implementation starts.
- Dispute resolution fallback needs a concrete UX and rule definition (vote window, tie handling, moderator override boundaries).
- Visibility permissions (group-wide vs explicit invite-only market visibility) must be decided before build.
- Pilot recruitment should include a contingency plan if 2-3 groups are not available by day 7.
- A light legal sanity pass should verify score-only mechanics for the intended launch jurisdiction.

## GSTACK REVIEW REPORT

| Review | Result |
|---|---|
| Step 0: Scope Challenge | Accepted as-is |
| Architecture Review | 1 issue found (dispute tie handling). |
| Code Quality Review | No major issues found. |
| Test Review | Coverage diagram produced; 4 gaps identified (see test plan file). |
| Performance Review | 2 issues found (ensure indexes; serialize resolves in DB transactions). |
| NOT in scope | Real-money rails; season mechanics; full analytics. |
| What already exists | No existing implementation; design doc is source of truth. |

### TODOS proposed
- Add DB transaction + unique constraint for `resolutions.market_id` (prevents concurrent double-resolve).
- Add idempotency-key handling for `predictions` and `resolve` endpoints.
- Add Row-Level Security (RLS) policies for Supabase and enforce invite-token flow server-side.
- Implement E2E tests: market create → predict → resolve (CRITICAL).

Test plan saved: [~/.gstack/projects/hackerhouse/mf-20260429-main-eng-review-test-plan-20260429-120000.md](~/.gstack/projects/hackerhouse/mf-20260429-main-eng-review-test-plan-20260429-120000.md)

**Parallelization**: 2 lanes — Backend (DB schema, API endpoints, transactions, RLS) and Frontend (Next.js pages, invite UX, client handling). Backend should be tackled first.

**Failure modes**: concurrent resolve race flagged as CRITICAL GAP (no test + no transaction) — must fix before pilot invites.

Outside voice: skipped (no external codex review ran).

Completion status: ISSUES_OPEN — unresolved: dispute tie policy and TODO approvals.

GSTACK REVIEW: saved on 2026-04-29 by plan-eng-review.
