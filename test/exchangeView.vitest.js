import { describe, it, expect } from 'vitest';
import {
  formatCents, probabilityLabel, ladderRows, leveragePresets,
  ticketValidationMessage, exchangeOrderErrorMessage, positionSummary, placeOrderBody,
} from '../lib/exchangeView.js';

describe('formatCents', () => {
  it('renders an integer cent price with the ¢ suffix', () => {
    expect(formatCents(63)).toBe('63¢');
  });
  it('rounds a fractional mark to the nearest cent', () => {
    expect(formatCents(62.5)).toBe('63¢');
    expect(formatCents(null)).toBe('—');
  });
});

describe('probabilityLabel', () => {
  it('reads a YES price as a probability phrase', () => {
    expect(probabilityLabel(63)).toBe('63% YES');
    expect(probabilityLabel(null)).toBe('No price yet');
  });
});

describe('ladderRows', () => {
  it('returns asks high→low then bids high→low with cumulative depth, capped at maxLevels each', () => {
    const book = { bids: [{ price: 62, qty: 5 }, { price: 60, qty: 10 }], asks: [{ price: 64, qty: 4 }, { price: 66, qty: 6 }] };
    const rows = ladderRows(book, 2);
    expect(rows.asks.map((r) => r.price)).toEqual([66, 64]);
    expect(rows.bids.map((r) => r.price)).toEqual([62, 60]);
    expect(rows.asks.find((r) => r.price === 64).cumulative).toBe(4);
    expect(rows.asks.find((r) => r.price === 66).cumulative).toBe(10);
  });
});

describe('leveragePresets', () => {
  it('offers 1x..maxLeverage from a standard set', () => {
    expect(leveragePresets(10)).toEqual([1, 2, 5, 10]);
    expect(leveragePresets(3)).toEqual([1, 2, 3]);
    expect(leveragePresets(1)).toEqual([1]);
  });
});

describe('ticketValidationMessage', () => {
  it('is empty for a valid limit order within balance', () => {
    expect(ticketValidationMessage({ type: 'limit', side: 'buy', price: 60, qty: 10, leverage: 1, available: 1000 })).toBe('');
  });
  it('flags qty < 1', () => {
    expect(ticketValidationMessage({ type: 'limit', side: 'buy', price: 60, qty: 0, leverage: 1, available: 1000 })).toBe('Enter a quantity of at least 1.');
  });
  it('flags a price outside 1..99 for limit orders', () => {
    expect(ticketValidationMessage({ type: 'limit', side: 'buy', price: 0, qty: 5, leverage: 1, available: 1000 })).toBe('Price must be between 1¢ and 99¢.');
  });
  it('flags margin exceeding available balance', () => {
    expect(ticketValidationMessage({ type: 'limit', side: 'buy', price: 60, qty: 100, leverage: 1, available: 1000 }))
      .toBe("That needs 6000 points of margin — you have 1000.");
  });
  it('lets leverage reduce the required margin below the balance', () => {
    expect(ticketValidationMessage({ type: 'limit', side: 'buy', price: 60, qty: 100, leverage: 10, available: 1000 })).toBe('');
  });
});

describe('exchangeOrderErrorMessage', () => {
  it('maps insufficient_margin to a friendly line', () => {
    expect(exchangeOrderErrorMessage(400, { error: 'insufficient_margin' })).toBe("Not enough points for that margin. Lower the size or raise leverage.");
  });
  it('maps leverage_too_high', () => {
    expect(exchangeOrderErrorMessage(400, { error: 'leverage_too_high' })).toBe('That leverage is too high for this price. Lower it.');
  });
  it('falls back for unknown errors', () => {
    expect(exchangeOrderErrorMessage(500, {})).toBe("Couldn't place your order. Try again.");
  });
});

describe('positionSummary', () => {
  it('summarizes a long with calm risk labels', () => {
    const s = positionSummary({ shares: 10, avgEntry: 60, leverage: 2, unrealizedPnl: 40, liquidationPrice: 33 });
    expect(s.sideLabel).toBe('Long YES');
    expect(s.sharesLabel).toBe('10 shares @ 60¢');
    expect(s.leverageLabel).toBe('2×');
    expect(s.pnlLabel).toBe('+40');
    expect(s.liquidationLabel).toBe('Liq 33¢');
  });
  it('summarizes a short and a flat position', () => {
    expect(positionSummary({ shares: -5, avgEntry: 40, leverage: 1, unrealizedPnl: -10, liquidationPrice: 99 }).sideLabel).toBe('Short YES');
    expect(positionSummary({ shares: 0 }).sideLabel).toBe('No position');
  });
});

describe('placeOrderBody', () => {
  it('builds the POST body from ticket state', () => {
    expect(placeOrderBody({ side: 'buy', type: 'limit', price: 63, qty: 10, leverage: 2 }))
      .toEqual({ side: 'buy', type: 'limit', price: 63, qty: 10, leverage: 2 });
  });
  it('omits price for a market order', () => {
    expect(placeOrderBody({ side: 'sell', type: 'market', qty: 5, leverage: 1 }))
      .toEqual({ side: 'sell', type: 'market', price: null, qty: 5, leverage: 1 });
  });
});
