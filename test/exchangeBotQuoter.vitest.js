import { describe, it, expect } from 'vitest';
const { convergedFairValue, desiredQuotes } = require('../server/exchange/botQuoter');

describe('convergedFairValue', () => {
  it('equals the seed when there is no volume yet', () => {
    expect(convergedFairValue({ seed: 70, mark: 50, volume: 0, scale: 100 })).toBe(70);
  });
  it('converges toward the mark as volume grows (seed weight -> 0)', () => {
    const early = convergedFairValue({ seed: 70, mark: 50, volume: 100, scale: 100 }); // w=0.5 -> 60
    const late = convergedFairValue({ seed: 70, mark: 50, volume: 900, scale: 100 });  // w=0.1 -> 52
    expect(early).toBe(60);
    expect(late).toBe(52);
  });
});

describe('desiredQuotes', () => {
  const base = { spread: 4, levels: 2, sizePerLevel: 50, maxInventory: 500, skewPerShare: 0 };

  it('posts a symmetric ladder around fair value when inventory is flat', () => {
    const q = desiredQuotes({ fairValue: 60, inventory: 0, ...base });
    expect(q).toEqual([
      { side: 'buy', price: 58, qty: 50 },
      { side: 'buy', price: 57, qty: 50 },
      { side: 'sell', price: 62, qty: 50 },
      { side: 'sell', price: 63, qty: 50 },
    ]);
  });

  it('skews the ladder down when long inventory (sheds risk)', () => {
    const q = desiredQuotes({ fairValue: 60, inventory: 100, ...base, skewPerShare: 0.02 });
    // center shifts down by 100*0.02 = 2 -> fairValue 58
    expect(q.find((o) => o.side === 'buy').price).toBe(56);
    expect(q.find((o) => o.side === 'sell').price).toBe(60);
  });

  it('withdraws bids at the long inventory cap (only quotes the reducing side)', () => {
    const q = desiredQuotes({ fairValue: 60, inventory: 500, ...base });
    expect(q.every((o) => o.side === 'sell')).toBe(true);
  });

  it('withdraws asks at the short inventory cap', () => {
    const q = desiredQuotes({ fairValue: 60, inventory: -500, ...base });
    expect(q.every((o) => o.side === 'buy')).toBe(true);
  });

  it('clamps quote prices into 1..99', () => {
    const q = desiredQuotes({ fairValue: 2, inventory: 0, ...base });
    expect(q.every((o) => o.price >= 1 && o.price <= 99)).toBe(true);
  });
});
