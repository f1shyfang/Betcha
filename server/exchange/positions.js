// Pure position accounting. A position is signed: shares > 0 is net long YES,
// shares < 0 is net short YES. Applying a fill may add to, reduce, close, or
// flip the position, realizing P&L on any portion that reduces existing size.
// Prices are cents; P&L is in points. avgEntry is reset to the new fill price
// once the position crosses through flat. Inputs are never mutated.

function emptyPosition() {
  return { shares: 0, avgEntry: 0, realizedPnl: 0 };
}

// 'buy' moves shares up (+qty), 'sell' moves shares down (-qty).
function applyFill(position, side, price, qty) {
  const signed = side === 'buy' ? qty : -qty;
  const oldShares = position.shares;
  let realized = position.realizedPnl;
  let shares = oldShares;
  let avgEntry = position.avgEntry;

  const sameDirection = oldShares === 0 || Math.sign(signed) === Math.sign(oldShares);

  if (sameDirection) {
    // Adding to (or opening) a position: blend the average entry by absolute size.
    const newAbs = Math.abs(oldShares) + qty;
    avgEntry = (Math.abs(oldShares) * avgEntry + qty * price) / newAbs;
    shares = oldShares + signed;
  } else {
    // Reducing/closing/flipping. The portion up to |oldShares| closes and
    // realizes P&L; any excess opens a fresh position at this price.
    const closingQty = Math.min(qty, Math.abs(oldShares));
    const dir = Math.sign(oldShares); // +1 was long, -1 was short
    realized += dir * (price - avgEntry) * closingQty;
    shares = oldShares + signed;
    if (shares === 0) {
      avgEntry = 0;
    } else if (Math.sign(shares) !== dir) {
      // Flipped through flat: remainder opens at the fill price.
      avgEntry = price;
    }
    // else: still same side, smaller — avgEntry unchanged.
  }

  return { shares, avgEntry, realizedPnl: realized };
}

module.exports = { applyFill, emptyPosition };
