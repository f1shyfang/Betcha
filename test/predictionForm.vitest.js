import { describe, it, expect } from 'vitest';
import {
  predictionErrorMessage,
  stablePredictionKey,
  applyOptimisticPrediction,
  shouldPoll,
  resolveSummary,
  clampStake,
  stakePresets,
  stakeValidationMessage,
  shareText,
  inviteText,
  marketStateLabel,
} from '../lib/predictionForm.js';

describe('predictionErrorMessage', () => {
  it('turns an insufficient-points 400 into a specific, friendly message using the returned balance', () => {
    const msg = predictionErrorMessage(400, { error: 'insufficient points', balance: 80 });
    expect(msg).toBe('You only have 80 points. Lower your stake.');
  });

  it('explains a 409 already-placed conflict in plain language', () => {
    const msg = predictionErrorMessage(409, { error: 'prediction already placed for this market' });
    expect(msg).toBe('You already placed a prediction on this market.');
  });

  it('tells the user to sign in again on 401', () => {
    expect(predictionErrorMessage(401, {})).toBe('Your session expired. Please sign in again.');
  });

  it('falls back to a friendly retry message when the error is unknown', () => {
    expect(predictionErrorMessage(500, {})).toBe("Couldn't place your prediction. Try again.");
  });
});

describe('stablePredictionKey', () => {
  it('is identical for the same market/user/choice/stake so rapid double-taps dedupe server-side', () => {
    const a = stablePredictionKey('m1', 'u1', true, 100);
    const b = stablePredictionKey('m1', 'u1', true, 100);
    expect(a).toBe(b);
  });

  it('differs when the choice or stake differs', () => {
    expect(stablePredictionKey('m1', 'u1', true, 100)).not.toBe(stablePredictionKey('m1', 'u1', false, 100));
    expect(stablePredictionKey('m1', 'u1', true, 100)).not.toBe(stablePredictionKey('m1', 'u1', true, 50));
  });

  it('does not embed a timestamp (key is purely a function of its inputs)', () => {
    const key = stablePredictionKey('m1', 'u1', true, 100);
    expect(key).toBe('pred-m1-u1-yes-100');
  });
});

describe('applyOptimisticPrediction', () => {
  const base = { yesCount: 3, noCount: 2, myBalance: 500 };

  it('bumps the YES count, sets the choice and stake, and debits the balance', () => {
    expect(applyOptimisticPrediction(base, true, 100)).toEqual({
      yesCount: 4,
      noCount: 2,
      myBalance: 400,
      myPrediction: true,
      myStake: 100,
    });
  });

  it('bumps the NO count for a NO prediction', () => {
    const next = applyOptimisticPrediction(base, false, 50);
    expect(next.noCount).toBe(3);
    expect(next.yesCount).toBe(3);
    expect(next.myPrediction).toBe(false);
    expect(next.myBalance).toBe(450);
  });

  it('does not mutate the input state', () => {
    applyOptimisticPrediction(base, true, 100);
    expect(base).toEqual({ yesCount: 3, noCount: 2, myBalance: 500 });
  });
});

describe('shouldPoll', () => {
  it('polls only when the tab is visible and the user is not mid-stake', () => {
    expect(shouldPoll(false, false)).toBe(true);
  });

  it('does not poll while the tab is hidden (no background-tab work)', () => {
    expect(shouldPoll(true, false)).toBe(false);
  });

  it('does not poll while a prediction confirm is pending (no reflow mid-decision)', () => {
    expect(shouldPoll(false, true)).toBe(false);
  });
});

describe('resolveSummary', () => {
  it('names the outcome and pluralizes the stake count', () => {
    expect(resolveSummary(8, true)).toBe('Resolve YES — this settles all 8 stakes.');
    expect(resolveSummary(8, false)).toBe('Resolve NO — this settles all 8 stakes.');
  });

  it('uses the singular for exactly one stake', () => {
    expect(resolveSummary(1, true)).toBe('Resolve YES — this settles 1 stake.');
  });

  it('warns when no stakes have been placed', () => {
    expect(resolveSummary(0, false)).toBe('Resolve NO — no stakes have been placed yet.');
  });
});

describe('clampStake', () => {
  it('keeps a valid stake unchanged', () => {
    expect(clampStake(100, 500)).toBe(100);
  });
  it('floors below 1 up to 1', () => {
    expect(clampStake(0, 500)).toBe(1);
    expect(clampStake(-5, 500)).toBe(1);
  });
  it('caps at the available balance', () => {
    expect(clampStake(600, 500)).toBe(500);
  });
  it('coerces decimals and junk to a whole number', () => {
    expect(clampStake(50.9, 500)).toBe(50);
    expect(clampStake('abc', 500)).toBe(1);
  });
  it('never returns less than 1 even when broke', () => {
    expect(clampStake(100, 0)).toBe(1);
  });
});

describe('stakePresets', () => {
  it('offers presets below balance plus a Max', () => {
    expect(stakePresets(500)).toEqual([
      { label: '25', value: 25 },
      { label: '50', value: 50 },
      { label: '100', value: 100 },
      { label: 'Max', value: 500 },
    ]);
  });
  it('drops presets that exceed the balance', () => {
    expect(stakePresets(80).map((p) => p.label)).toEqual(['25', '50', 'Max']);
    expect(stakePresets(80).find((p) => p.label === 'Max').value).toBe(80);
  });
  it('returns just Max when balance is below the smallest preset', () => {
    expect(stakePresets(20)).toEqual([{ label: 'Max', value: 20 }]);
  });
  it('returns nothing when the user is broke', () => {
    expect(stakePresets(0)).toEqual([]);
  });
});

describe('stakeValidationMessage', () => {
  it('is empty for a valid stake', () => {
    expect(stakeValidationMessage(100, 500)).toBe('');
  });
  it('flags being out of points', () => {
    expect(stakeValidationMessage(1, 0)).toBe("You're out of points — you can't predict on this market.");
  });
  it('flags a stake above the balance with the exact balance', () => {
    expect(stakeValidationMessage(600, 500)).toBe('You only have 500 points.');
  });
});

describe('shareText', () => {
  it('states the title and outcome', () => {
    expect(shareText('Will it rain Saturday?', true)).toBe('"Will it rain Saturday?" resolved YES on Betcha.');
    expect(shareText('Will it rain Saturday?', false)).toBe('"Will it rain Saturday?" resolved NO on Betcha.');
  });

  it('contains no em dash (copy rule)', () => {
    expect(shareText('Anything', true)).not.toMatch(/—|--/);
  });
});

describe('inviteText', () => {
  it('invites friends to take a side and includes the market URL', () => {
    const text = inviteText('Will it rain Saturday?', 'https://betchaa.vercel.app/markets/abc');
    expect(text).toContain('Will it rain Saturday?');
    expect(text).toContain('https://betchaa.vercel.app/markets/abc');
    expect(text.toLowerCase()).toContain('take a side');
  });

  it('contains no em dash (copy rule)', () => {
    expect(inviteText('Anything', 'https://x.test')).not.toMatch(/—|--/);
  });
});

describe('marketStateLabel', () => {
  it('capitalizes the known states', () => {
    expect(marketStateLabel('open')).toBe('Open');
    expect(marketStateLabel('resolved')).toBe('Resolved');
  });

  it('capitalizes any other state instead of leaking a raw lowercase enum', () => {
    expect(marketStateLabel('disputed')).toBe('Disputed');
  });

  it('is empty for a missing state', () => {
    expect(marketStateLabel('')).toBe('');
    expect(marketStateLabel(null)).toBe('');
    expect(marketStateLabel(undefined)).toBe('');
  });
});
