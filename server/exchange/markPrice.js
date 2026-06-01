// Pure mark-price function. The mark is the risk reference (drives unrealized
// P&L and liquidation) and must resist single-print manipulation, so it is the
// MID of the best bid/ask, never the last trade. The mid is by construction
// inside the [bestBid, bestAsk] band. One-sided book -> the present best quote.
// Empty book -> last trade. Nothing at all -> null.

function best(orders, pick) {
  if (orders.length === 0) return null;
  return orders.reduce((acc, o) => pick(o.price, acc), orders[0].price);
}

function markPrice(book, lastTrade) {
  const bestBid = best(book.bids, Math.max);
  const bestAsk = best(book.asks, Math.min);
  if (bestBid !== null && bestAsk !== null) return (bestBid + bestAsk) / 2;
  if (bestBid !== null) return bestBid;
  if (bestAsk !== null) return bestAsk;
  return lastTrade === undefined ? null : lastTrade;
}

module.exports = { markPrice };
