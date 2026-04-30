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

## Design Decisions (from /plan-design-review 2026-04-30)

### Information Architecture
- **D3 ACCEPTED**: Flip group dashboard order — Live Markets → Leaderboard → Create Market form. Users see social context before being asked to create. (groups/[id].js)
- **D4 ACCEPTED**: Hide "Resolve Market" controls from non-creators. Conditionally render based on `currentUser.id === market.creator_id`. Requires `creator_id` in markets API response. (markets/[id].js)

### Interaction States
- **D5 ACCEPTED**: Fix invite banner — show full shareable URL (`window.location.origin + '/join?token=' + token`) with copy button. Remove "POST /api/groups/join" API docs from UI. (groups/[id].js)
- **D6 ACCEPTED**: Show user's own prediction after voting. Filter predictions for currentUser.id, display "Your prediction: YES/NO" below odds bar, dim unchosen button. (markets/[id].js)
- **D7 ACCEPTED**: Replace bare "Loading..." text with skeleton shimmer states on all 4 app pages. One CSS shimmer animation, 4 component changes.
- **D11 ACCEPTED**: Create `/join?token=` route (pages/join.js). If not logged in: show "Join Betcha to accept this invite" with signup/login buttons, preserving token in URL. If logged in: auto-call POST /api/groups/join and redirect to group.

### Emotional Arc
- **D8 ACCEPTED**: Replace bare resolution banner with: outcome prominently + correct predictors list + score delta for current user + share button. Transforms the climactic product moment from announcement to social payoff. (markets/[id].js)

### AI Slop Removal
- **D9 ACCEPTED**: Replace both 3-column feature grids (`.cards` section lines 241-253 and `.use-cases` section lines 255-268) with a single differentiated section — horizontal scrolling ticker of real-sounding example market questions, or a large-type statement block. (~45 min implementation)
- **D10 ACCEPTED**: Remove Quick Create market widget from landing page (lines 194-237). Landing has one job: waitlist capture. Quick Create belongs in the authenticated app only.

### Auth Flow
- **D13 ACCEPTED**: Auto-redirect after auth success. Login → /groups after 500ms delay. Signup → /login (with `?created=true` param so login.js can show "Account created — please log in").

### Design System
- Use existing `.leaderboard-section` and `.leaderboard-row` CSS classes for leaderboard in groups/[id].js instead of generic `.cards` grid.
- **D12 ACCEPTED**: Fix leaderboard to show email-prefix or display_name instead of UUID fragments. Requires JOIN on users table in /api/groups/[id]/leaderboard endpoint.

### Deferred (explicit)
- Whether a logged-in user visiting the landing page should auto-redirect to /groups — deferred, not pilot-critical.
- Tablet breakpoint (between 640px mobile and 1100px desktop) — deferred, pilot is mobile-first.
- First-time user onboarding state for new group members — deferred to post-pilot.

## NOT in scope
- Real-money rails
- Season mechanics
- Full analytics
- Forgot password flow (Supabase handles via email)
- Push notifications

## What already exists
- `globals.css`: Complete design token system matching DESIGN.md — Cabinet Grotesk, Source Sans 3, Geist, color variables, leaderboard CSS classes (`.leaderboard-section`, `.leaderboard-row`), bottom nav, market cards, animation system.
- All 7 pages are built. This review addresses UX gaps in the implementation, not greenfield design.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | clean | mode: Approach A, 0 critical gaps |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 4 issues, 2 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | issues_open | score: 2/10 → 7/10, 10 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **UNRESOLVED:** 1 deferred design decision (logged-in user landing page redirect)
- **VERDICT:** Eng Review has open issues — run eng review before pilot invitations go live.
