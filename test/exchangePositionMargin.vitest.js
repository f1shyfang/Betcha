import { describe, it, expect } from 'vitest';
const { positionMargin } = require('../server/exchange/positionMargin');

describe('positionMargin', () => {
  it('is 0 for a flat position', () => {
    expect(positionMargin({ shares: 0, avgEntry: 0, leverage: 1 })).toBe(0);
  });
  it('long unlevered locks full premium', () => {
    expect(positionMargin({ shares: 10, avgEntry: 60, leverage: 1 })).toBe(600);
  });
  it('long 4x locks a quarter', () => {
    expect(positionMargin({ shares: 10, avgEntry: 60, leverage: 4 })).toBe(150);
  });
  it('short locks (100-entry)/leverage', () => {
    expect(positionMargin({ shares: -10, avgEntry: 60, leverage: 2 })).toBe(200);
  });
});
