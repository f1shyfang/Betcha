import { describe, it, expect } from 'vitest';
const { matchOrder } = require('../server/exchange/matching');

const ask = (id, price, qty, sequence) => ({ id, userId: 'm', side: 'sell', price, qty, sequence });
const bid = (id, price, qty, sequence) => ({ id, userId: 'm', side: 'buy', price, qty, sequence });

describe('matchOrder', () => {
  it('fills a marketable buy against the cheapest asks first (price priority)', () => {
    const book = { bids: [], asks: [ask('a1', 64, 5, 2), ask('a2', 63, 10, 1)] };
    const res = matchOrder({ side: 'buy', price: 64, qty: 12 }, book);
    expect(res.fills).toEqual([
      { price: 63, qty: 10, makerId: 'a2', makerUserId: 'm' },
      { price: 64, qty: 2, makerId: 'a1', makerUserId: 'm' },
    ]);
    expect(res.filledQty).toBe(12);
    expect(res.residualQty).toBe(0);
  });

  it('breaks price ties by sequence (time priority)', () => {
    const book = { bids: [], asks: [ask('late', 63, 5, 9), ask('early', 63, 5, 1)] };
    const res = matchOrder({ side: 'buy', price: 63, qty: 5 }, book);
    expect(res.fills).toEqual([{ price: 63, qty: 5, makerId: 'early', makerUserId: 'm' }]);
  });

  it('does not cross the spread: a buy below the best ask rests entirely', () => {
    const book = { bids: [], asks: [ask('a1', 64, 5, 1)] };
    const res = matchOrder({ side: 'buy', price: 60, qty: 5 }, book);
    expect(res.fills).toEqual([]);
    expect(res.residualQty).toBe(5);
  });

  it('partially fills and reports the residual to rest', () => {
    const book = { bids: [], asks: [ask('a1', 63, 4, 1)] };
    const res = matchOrder({ side: 'buy', price: 63, qty: 10 }, book);
    expect(res.filledQty).toBe(4);
    expect(res.residualQty).toBe(6);
  });

  it('a market buy (price null) sweeps every ask regardless of price', () => {
    const book = { bids: [], asks: [ask('a1', 70, 3, 1), ask('a2', 90, 3, 2)] };
    const res = matchOrder({ side: 'buy', price: null, qty: 6 }, book);
    expect(res.filledQty).toBe(6);
  });

  it('a sell matches the highest bids first', () => {
    const book = { bids: [bid('b1', 60, 5, 1), bid('b2', 62, 5, 2)], asks: [] };
    const res = matchOrder({ side: 'sell', price: 60, qty: 7 }, book);
    expect(res.fills).toEqual([
      { price: 62, qty: 5, makerId: 'b2', makerUserId: 'm' },
      { price: 60, qty: 2, makerId: 'b1', makerUserId: 'm' },
    ]);
  });
});
