import { describe, it, expect } from 'vitest';
import { toUnixSeconds, priceSeries, depthRows, botStatusLines, eventFeed } from '../lib/proView.js';

describe('toUnixSeconds', () => {
  it('converts ms numbers, ISO strings, and Date to integer seconds', () => {
    expect(toUnixSeconds(1700000000000)).toBe(1700000000);
    expect(toUnixSeconds('2023-11-14T22:13:20.000Z')).toBe(1700000000);
    expect(toUnixSeconds(new Date(1700000000000))).toBe(1700000000);
  });
});

describe('priceSeries', () => {
  const history = {
    prices: [{ at: 1700000000000, price: 60 }, { at: 1700000060000, price: 63 }],
    botBand: [{ at: 1700000000000, bid: 58, ask: 62 }],
    botMarkers: [{ at: 1700000060000, price: 63, side: 'sell' }],
  };
  it('builds ascending {time,value} line/bid/ask series', () => {
    const s = priceSeries(history);
    expect(s.line).toEqual([{ time: 1700000000, value: 60 }, { time: 1700000060, value: 63 }]);
    expect(s.bid).toEqual([{ time: 1700000000, value: 58 }]);
    expect(s.ask).toEqual([{ time: 1700000000, value: 62 }]);
  });
  it('maps bot markers (sell=above/arrowDown, buy=below/arrowUp)', () => {
    const m = priceSeries(history).markers[0];
    expect(m.time).toBe(1700000060);
    expect(m.position).toBe('aboveBar');
    expect(m.shape).toBe('arrowDown');
  });
  it('dedupes equal timestamps keeping the last', () => {
    const s = priceSeries({ prices: [{ at: 1000, price: 1 }, { at: 1000, price: 2 }], botBand: [], botMarkers: [] });
    expect(s.line).toEqual([{ time: 1, value: 2 }]);
  });
});

describe('depthRows', () => {
  it('accumulates from the mid outward and splits bot depth', () => {
    const book = {
      bids: [{ price: 62, qty: 5, botQty: 5 }, { price: 60, qty: 10, botQty: 4 }],
      asks: [{ price: 64, qty: 4, botQty: 4 }, { price: 66, qty: 6, botQty: 0 }],
    };
    const d = depthRows(book);
    expect(d.bids.map((r) => [r.price, r.cum, r.cumBot])).toEqual([[62, 5, 5], [60, 15, 9]]);
    expect(d.asks.map((r) => [r.price, r.cum, r.cumBot])).toEqual([[64, 4, 4], [66, 10, 4]]);
    expect(d.maxCum).toBe(15);
  });
});

describe('botStatusLines', () => {
  it('labels a long inventory and cap usage', () => {
    const s = botStatusLines({ inventory: 120, fairValue: 61, bestBid: 59, bestAsk: 63, spread: 4, maxInventory: 500, capUsedPct: 24 });
    expect(s.inventoryLabel).toBe('+120 YES');
    expect(s.quoteLabel).toBe('59¢ / 63¢');
    expect(s.spreadLabel).toBe('4¢ spread');
    expect(s.capLabel).toBe('120 / 500');
    expect(s.capPct).toBe(24);
  });
  it('labels short and flat', () => {
    expect(botStatusLines({ inventory: -40, maxInventory: 500 }).inventoryLabel).toBe('-40 short');
    expect(botStatusLines({ inventory: 0, maxInventory: 500 }).inventoryLabel).toBe('flat');
  });
});

describe('eventFeed', () => {
  it('shows trades as fills and collapses a bot re-quote batch into one row', () => {
    const trades = [{ price: 63, qty: 4, at: 1700000060000 }];
    const recentOrders = [
      { id: 'o1', isBot: true, side: 'buy', price: 58, qty: 50, status: 'cancelled', at: 1700000000000 },
      { id: 'o2', isBot: true, side: 'sell', price: 62, qty: 50, status: 'cancelled', at: 1700000000000 },
      { id: 'o3', isBot: true, side: 'buy', price: 59, qty: 50, status: 'open', at: 1700000050000 },
      { id: 'o4', isBot: true, side: 'sell', price: 63, qty: 50, status: 'open', at: 1700000050000 },
      { id: 'h1', isBot: false, side: 'buy', price: 60, qty: 10, status: 'open', at: 1700000055000 },
    ];
    const rows = eventFeed(recentOrders, trades, { limit: 10 });
    const kinds = rows.map((r) => r.kind);
    expect(kinds.filter((k) => k === 'fill').length).toBe(1);
    expect(kinds.filter((k) => k === 'bot_requote').length).toBe(2);
    expect(kinds.filter((k) => k === 'human_order').length).toBe(1);
    expect(rows[0].at >= rows[rows.length - 1].at).toBe(true);
  });
});
