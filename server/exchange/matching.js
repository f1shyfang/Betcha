// Pure CLOB matching engine. Given an incoming order and a book snapshot,
// returns the fills (at maker prices, price-time priority) and how much of the
// incoming order remains unfilled. No DB, no mutation of inputs.

// A buy crosses asks priced <= its limit; a sell crosses bids priced >= its
// limit. price === null means a market order (crosses any price).
function isMarketable(incomingSide, limitPrice, makerPrice) {
  if (limitPrice === null) return true;
  return incomingSide === 'buy' ? makerPrice <= limitPrice : makerPrice >= limitPrice;
}

// Best-first ordering of the resting side we match against.
function sortMakers(makers, incomingSide) {
  // Buy hits asks: lowest price first. Sell hits bids: highest price first.
  // Ties broken by sequence (earliest first) = time priority.
  return [...makers].sort((a, b) =>
    a.price !== b.price
      ? (incomingSide === 'buy' ? a.price - b.price : b.price - a.price)
      : a.sequence - b.sequence
  );
}

function matchOrder(incoming, book) {
  const makers = sortMakers(incoming.side === 'buy' ? book.asks : book.bids, incoming.side);
  const fills = [];
  let remaining = incoming.qty;

  for (const maker of makers) {
    if (remaining <= 0) break;
    if (!isMarketable(incoming.side, incoming.price, maker.price)) break;
    const qty = Math.min(remaining, maker.qty);
    if (qty <= 0) continue;
    fills.push({ price: maker.price, qty, makerId: maker.id, makerUserId: maker.userId });
    remaining -= qty;
  }

  return { fills, filledQty: incoming.qty - remaining, residualQty: remaining };
}

module.exports = { matchOrder };
