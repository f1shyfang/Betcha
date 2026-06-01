// Pure margin math. Max loss per share is bounded by the binary payout (0..100):
// a long loses at most its price; a short loses at most (100 - price). Required
// margin is the max loss scaled down by leverage, rounded UP so the system is
// never under-collateralized for the unlevered remainder.

function maxLossPerShare(side, price) {
  return side === 'buy' ? price : 100 - price;
}

function requiredMargin({ side, price, qty, leverage = 1 }) {
  const maxLoss = maxLossPerShare(side, price) * qty;
  return Math.ceil(maxLoss / leverage);
}

module.exports = { maxLossPerShare, requiredMargin };
