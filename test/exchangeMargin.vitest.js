import { describe, it, expect } from 'vitest';
const { maxLossPerShare, requiredMargin } = require('../server/exchange/margin');

describe('maxLossPerShare', () => {
  it('a long can lose its full price (worst case the share goes to 0)', () => {
    expect(maxLossPerShare('buy', 60)).toBe(60);
  });
  it('a short can lose 100 minus the price (worst case the share goes to 100)', () => {
    expect(maxLossPerShare('sell', 60)).toBe(40);
  });
});

describe('requiredMargin', () => {
  it('unlevered long escrows the full premium', () => {
    expect(requiredMargin({ side: 'buy', price: 60, qty: 10, leverage: 1 })).toBe(600);
  });
  it('unlevered short escrows the full max loss', () => {
    expect(requiredMargin({ side: 'sell', price: 60, qty: 10, leverage: 1 })).toBe(400);
  });
  it('leverage divides the margin and never under-collateralizes (ceils)', () => {
    expect(requiredMargin({ side: 'buy', price: 60, qty: 10, leverage: 4 })).toBe(150);
    expect(requiredMargin({ side: 'sell', price: 60, qty: 10, leverage: 3 })).toBe(134); // ceil(400/3)
  });
  it('defaults leverage to 1 when omitted', () => {
    expect(requiredMargin({ side: 'buy', price: 60, qty: 10 })).toBe(600);
  });
});
