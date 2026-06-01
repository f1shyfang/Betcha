// Compute the margin currently locked by an open position.
// A flat position (shares === 0) locks nothing; otherwise delegate to
// requiredMargin with the correct side derived from the sign of shares.
const { requiredMargin } = require('./margin');

function positionMargin({ shares, avgEntry, leverage }) {
  if (shares === 0) return 0;
  const side = shares > 0 ? 'buy' : 'sell';
  return requiredMargin({ side, price: avgEntry, qty: Math.abs(shares), leverage });
}

module.exports = { positionMargin };
