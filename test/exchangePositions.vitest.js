import { describe, it, expect } from 'vitest';
const { applyFill, emptyPosition } = require('../server/exchange/positions');

describe('applyFill', () => {
  it('opens a long: buying 10 @60 from flat', () => {
    const p = applyFill(emptyPosition(), 'buy', 60, 10);
    expect(p).toEqual({ shares: 10, avgEntry: 60, realizedPnl: 0 });
  });

  it('adds to a long with a weighted average entry', () => {
    let p = applyFill(emptyPosition(), 'buy', 60, 10);
    p = applyFill(p, 'buy', 70, 10);
    expect(p).toEqual({ shares: 20, avgEntry: 65, realizedPnl: 0 });
  });

  it('reduces a long and realizes P&L on the closed portion', () => {
    let p = applyFill(emptyPosition(), 'buy', 60, 20);
    p = applyFill(p, 'sell', 80, 5);
    // closed 5 @ (80-60) = +100 realized; 15 still long @60
    expect(p).toEqual({ shares: 15, avgEntry: 60, realizedPnl: 100 });
  });

  it('opens a short by selling from flat (avg entry = sell price)', () => {
    const p = applyFill(emptyPosition(), 'sell', 60, 10);
    expect(p).toEqual({ shares: -10, avgEntry: 60, realizedPnl: 0 });
  });

  it('realizes P&L correctly when closing a short (profit when price falls)', () => {
    let p = applyFill(emptyPosition(), 'sell', 60, 10);
    p = applyFill(p, 'buy', 50, 10);
    // short closed @ (60-50) = +100 realized; flat
    expect(p).toEqual({ shares: 0, avgEntry: 0, realizedPnl: 100 });
  });

  it('flips from long to short, realizing the full long and opening the remainder short', () => {
    let p = applyFill(emptyPosition(), 'buy', 60, 10);
    p = applyFill(p, 'sell', 70, 15);
    // close 10 long @ (70-60)=+100; open 5 short @70
    expect(p).toEqual({ shares: -5, avgEntry: 70, realizedPnl: 100 });
  });

  it('adds to a short with a weighted average entry', () => {
    let p = applyFill(emptyPosition(), 'sell', 60, 10);
    p = applyFill(p, 'sell', 70, 10);
    expect(p).toEqual({ shares: -20, avgEntry: 65, realizedPnl: 0 });
  });

  it('returns the position unchanged for a non-positive quantity', () => {
    const start = applyFill(emptyPosition(), 'buy', 60, 10);
    expect(applyFill(start, 'buy', 99, 0)).toEqual({ shares: 10, avgEntry: 60, realizedPnl: 0 });
  });
});
