# Product

## Register

product

## Users

Small friend groups and curious builders who want a lightweight, social way to make bets on anything: who finishes the marathon, whether the launch ships on time, which friend caves first. They show up in a casual, social context (often on their phone, often mid-conversation in a group chat), not at a trading desk. The job to be done: spin up a market in seconds, get friends to take a side and stake points, then settle it and rib each other about the outcome. Stakes are points and bragging rights, not real money.

## Product Purpose

Betcha is a social prediction-market web app where friends create markets on anything, put points behind their opinions, and keep each other accountable. It exists to make friendly disagreement structured and fun: instead of "wanna bet?" evaporating into nothing, it becomes a market with a real resolution and a leaderboard. Success looks like a group returning to settle and start markets repeatedly because it's genuinely entertaining, the outcomes feel fair, and the points/standings give every prediction a little weight.

Primary surfaces in priority order: the market detail + prediction flow, the markets list, the group leaderboard, market creation, and auth/onboarding. A marketing/waitlist landing exists as a secondary brand surface; treat it with the brand register per-task when working on it.

## Brand Personality

Energetic, social, and lightly irreverent. Three words: playful, sharp, social. It should feel like a product with a sense of humor that still respects your attention and your standings, the opposite of a finance dashboard that forgot how to smile. Confident and quick, never hype-y or manipulative. Copy is specific and conversational, the way friends actually talk smack, not casino come-ons or trading-floor jargon.

## Anti-references

- **Casino / gambling apps.** No neon-and-coins, no slot-machine energy, no "just one more bet" dark patterns. Betcha is points-and-bragging-rights between friends, never predatory.
- **Finance / trading terminals.** No dense Bloomberg-style data walls, cold institutional blues, or ticker overload. Odds and counts must be legible and calm, not a wall of numbers.
- **Crypto / degen aesthetics.** No hyper-saturated gradients, "to the moon" hype, or jargon-heavy pump energy.
- **Sterile enterprise SaaS.** No generic SaaS blue, no endless identical icon-heading-text card grids, no soulless dashboard template. Personality is the point.

## Design Principles

- **Personality over neutrality.** Every screen should carry the brand's voice and energy. When a choice is between "safe and generic" and "characterful and clear," pick characterful, as long as clarity holds.
- **Social, not solitary.** This is a multiplayer product. Surface the people: who's in, who took which side, who's winning. The group is the feature, not a footnote.
- **Playful, never predatory.** Fun and fast, but it respects the user's attention and their standings. No manipulation, no manufactured urgency, no dark patterns around staking.
- **Legible at the moment of decision.** The Yes/No choice, the stake, the odds, and the outcome must be instantly readable. Decisions are the core interaction; never make the user squint or rely on color alone to tell sides apart.
- **Fast and lightweight.** Creating a market, placing a prediction, and seeing where things stand should each feel near-instant. Speed is part of the fun.

## Accessibility & Inclusion

Target WCAG 2.2 AA. Body text meets 4.5:1 contrast (large/bold text 3:1); all interactive controls have visible focus states and full keyboard operability. Because the core interaction is a red/green Yes/No bet, never encode the side by color alone (WCAG 1.4.1, Use of Color): pair it with a clear label, icon, and/or position so colorblind users can always tell Yes from No. Honor `prefers-reduced-motion` for the brand's playful emphasis animations.
