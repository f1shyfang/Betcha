import { describe, it, expect } from 'vitest';
const { markPrice } = require('../server/exchange/markPrice');

const ask = (price) => ({ side: 'sell', price, qty: 10, sequence: 1, id: 'a', userId: 'm' });
const bid = (price) => ({ side: 'buy', price, qty: 10, sequence: 1, id: 'b', userId: 'm' });

describe('markPrice', () => {
  it('is the mid of best bid and best ask when both sides exist', () => {
    const book = { bids: [bid(62), bid(60)], asks: [ask(64), ask(66)] };
    expect(markPrice(book, 50)).toBe(63);
  });

  it('uses the best quote when the book is one-sided (not the last trade)', () => {
    expect(markPrice({ bids: [bid(62)], asks: [] }, 50)).toBe(62);
    expect(markPrice({ bids: [], asks: [ask(64)] }, 50)).toBe(64);
  });

  it('falls back to the last trade only when the book is empty', () => {
    expect(markPrice({ bids: [], asks: [] }, 57)).toBe(57);
  });

  it('returns null when there is neither a book nor a last trade', () => {
    expect(markPrice({ bids: [], asks: [] }, null)).toBe(null);
  });
});
