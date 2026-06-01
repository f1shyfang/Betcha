import { describe, it, expect } from 'vitest';
const { bankruptcyPrice, liquidationPrice, mustLiquidate } = require('../server/exchange/liquidation');

describe('bankruptcyPrice', () => {
  it('an unlevered long busts at 0 and an unlevered short busts at 100', () => {
    expect(bankruptcyPrice({ side: 'buy', entry: 60, leverage: 1 })).toBe(0);
    expect(bankruptcyPrice({ side: 'sell', entry: 60, leverage: 1 })).toBe(100);
  });
  it('a 4x long at 60 busts at 45 (60*(1-1/4))', () => {
    expect(bankruptcyPrice({ side: 'buy', entry: 60, leverage: 4 })).toBe(45);
  });
  it('a 4x short at 60 busts at 70 (60 + (100-60)/4)', () => {
    expect(bankruptcyPrice({ side: 'sell', entry: 60, leverage: 4 })).toBe(70);
  });
});

describe('liquidationPrice', () => {
  it('sits inside the bankruptcy price by the maintenance buffer (long)', () => {
    // bankruptcy 45, maintenance 3 -> liquidation at 48 (triggers before bust)
    expect(liquidationPrice({ side: 'buy', entry: 60, leverage: 4, maintenanceMargin: 3 })).toBe(48);
  });
  it('sits inside the bankruptcy price by the maintenance buffer (short)', () => {
    // bankruptcy 70, maintenance 3 -> liquidation at 67
    expect(liquidationPrice({ side: 'sell', entry: 60, leverage: 4, maintenanceMargin: 3 })).toBe(67);
  });
});

describe('mustLiquidate', () => {
  const params = { leverage: 4, maintenanceMargin: 3 };
  it('liquidates a long once the mark falls to/through its liquidation price', () => {
    const pos = { side: 'buy', entry: 60 }; // liq at 48
    expect(mustLiquidate(pos, 49, params)).toBe(false);
    expect(mustLiquidate(pos, 48, params)).toBe(true);
    expect(mustLiquidate(pos, 47, params)).toBe(true);
  });
  it('liquidates a short once the mark rises to/through its liquidation price', () => {
    const pos = { side: 'sell', entry: 60 }; // liq at 67
    expect(mustLiquidate(pos, 66, params)).toBe(false);
    expect(mustLiquidate(pos, 67, params)).toBe(true);
  });
});
