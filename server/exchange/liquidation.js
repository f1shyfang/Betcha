// Pure liquidation math for the futures model. Two prices per position:
//   bankruptcy price - the mark at which equity hits zero (margin fully consumed)
//   liquidation price - sits inside bankruptcy by the maintenance buffer, so a
//                       liquidation triggers while equity is still positive.
// A long is liquidated when the mark falls to/through its liquidation price; a
// short when the mark rises to/through it. Inputs are cents; outputs are cents.

function bankruptcyPrice({ side, entry, leverage }) {
  return side === 'buy'
    ? entry * (1 - 1 / leverage)
    : entry + (100 - entry) / leverage;
}

function liquidationPrice({ side, entry, leverage, maintenanceMargin }) {
  const bust = bankruptcyPrice({ side, entry, leverage });
  return side === 'buy' ? bust + maintenanceMargin : bust - maintenanceMargin;
}

function mustLiquidate(position, mark, { leverage, maintenanceMargin }) {
  const liq = liquidationPrice({ ...position, leverage, maintenanceMargin });
  return position.side === 'buy' ? mark <= liq : mark >= liq;
}

module.exports = { bankruptcyPrice, liquidationPrice, mustLiquidate };
