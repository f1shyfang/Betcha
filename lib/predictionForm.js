// Pure helpers for the prediction-placing flow. Kept framework-free so they can
// be unit-tested without a DOM, and shared between the page and any other caller.

// Map a failed POST /predictions response to a specific, friendly, on-brand
// message. The server returns the remaining balance on an insufficient-points
// rejection, so we use it to tell the user exactly how much they can stake.
export function predictionErrorMessage(status, payload = {}) {
  const error = String(payload.error || '');
  if (status === 401) return 'Your session expired. Please sign in again.';
  if (status === 409 || /already placed/i.test(error)) {
    return 'You already placed a prediction on this market.';
  }
  if (status === 400 && /insufficient/i.test(error)) {
    return typeof payload.balance === 'number'
      ? `You only have ${payload.balance} points. Lower your stake.`
      : 'Not enough points for that stake. Lower it and try again.';
  }
  return "Couldn't place your prediction. Try again.";
}

// A deterministic idempotency key: identical inputs produce an identical key, so
// a rapid double-tap collapses to one prediction server-side. No timestamp.
export function stablePredictionKey(marketId, userId, choice, stake) {
  return `pred-${marketId}-${userId}-${choice ? 'yes' : 'no'}-${stake}`;
}

// Optimistic local update so the UI reflects a placed prediction instantly,
// without a full page reload. Pure: returns the next view state, never mutates.
// The server fetch that follows reconciles any drift.
export function applyOptimisticPrediction(state, choice, stake) {
  return {
    yesCount: state.yesCount + (choice ? 1 : 0),
    noCount: state.noCount + (choice ? 0 : 1),
    myBalance: state.myBalance - stake,
    myPrediction: choice,
    myStake: stake,
  };
}

// Whether the 5s live-stats poll should fire: only when the tab is visible
// (no background-tab work) and the user isn't mid-decision (no reflow under them).
export function shouldPoll(hidden, staking) {
  return !hidden && !staking;
}

// Confirmation copy for the destructive resolve action — states the outcome and
// how many stakes it will settle, so the creator commits with full context.
export function resolveSummary(predictionCount, outcome) {
  const side = outcome ? 'YES' : 'NO';
  if (predictionCount === 0) return `Resolve ${side} — no stakes have been placed yet.`;
  if (predictionCount === 1) return `Resolve ${side} — this settles 1 stake.`;
  return `Resolve ${side} — this settles all ${predictionCount} stakes.`;
}

// Constrain a stake to a whole number in [1, balance]. Junk/decimals/negatives
// all resolve to something sane so the input can't hold an unsubmittable value.
export function clampStake(value, balance) {
  const max = Math.max(1, Math.floor(balance));
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return 1;
  return Math.min(max, Math.max(1, n));
}

// Quick-stake chips: standard amounts that fit the balance, plus a "Max".
// Empty when the user has nothing to stake.
export function stakePresets(balance) {
  const max = Math.floor(balance);
  if (max < 1) return [];
  const presets = [25, 50, 100]
    .filter((v) => v < max)
    .map((v) => ({ label: String(v), value: v }));
  return [...presets, { label: 'Max', value: max }];
}

// Share copy for a resolved market. Plain sentence, no em dash, works as both
// Web Share text and clipboard fallback.
export function shareText(title, outcome) {
  return `"${title}" resolved ${outcome ? 'YES' : 'NO'} on Betcha.`;
}

// Invite copy for an OPEN market — pulls friends in to pick a side. Includes the
// market URL so the link is shareable straight into a group chat.
export function inviteText(title, url) {
  return `Take a side on "${title}". Predict YES or NO on Betcha: ${url}`;
}

// Inline, pre-submit validation copy. Empty string means the stake is fine.
export function stakeValidationMessage(stake, balance) {
  if (balance < 1) return "You're out of points — you can't predict on this market.";
  if (stake < 1) return 'Enter a stake of at least 1 point.';
  if (stake > balance) return `You only have ${balance} points.`;
  return '';
}
