// Pure view helpers for the exchange (order-book) trading flow. Kept
// framework-free so they can be unit-tested without a DOM, and shared between
// the order-ticket component, the ladder, and the position panel.

// Format a cent price like "63¢". Rounds fractional prices. Returns an em dash
// for null/undefined so the UI always has something readable to display.
export function formatCents(p) {
  if (p == null) return '—';
  return Math.round(p) + '¢';
}

// Human probability phrase derived from the YES-side price. The price and the
// probability are the same number on a binary prediction market.
export function probabilityLabel(p) {
  if (p == null) return 'No price yet';
  return Math.round(p) + '% YES';
}

// Build display rows for both sides of the order book ladder.
//
// Asks are sorted ascending by price internally (lowest ask = best ask, inside
// of the spread). We take the first maxLevels, compute cumulative qty from the
// inside outward (low price → high price), then reverse to display high→low.
//
// Bids are sorted descending (highest bid = best bid). Take first maxLevels,
// compute cumulative from inside outward (high price → low price), keep as-is
// for high→low display.
//
// Each row: { price, qty, cumulative }.
export function ladderRows(book, maxLevels = 5) {
  const asksAsc = [...(book.asks || [])]
    .sort((a, b) => a.price - b.price)
    .slice(0, maxLevels);

  let cum = 0;
  for (const row of asksAsc) {
    cum += row.qty;
    row.cumulative = cum;
  }
  const asks = [...asksAsc].reverse();

  const bidsDesc = [...(book.bids || [])]
    .sort((a, b) => b.price - a.price)
    .slice(0, maxLevels);

  cum = 0;
  for (const row of bidsDesc) {
    cum += row.qty;
    row.cumulative = cum;
  }
  const bids = bidsDesc;

  return { asks, bids };
}

// Quick-leverage chips: standard values that fit within maxLeverage, with the
// max itself appended if it isn't already in the standard list.
export function leveragePresets(max) {
  const standard = [1, 2, 5, 10];
  const filtered = standard.filter((v) => v <= max);
  if (max > 1 && !filtered.includes(max)) {
    filtered.push(max);
  }
  return [...new Set(filtered)].sort((a, b) => a - b);
}

// Inline, pre-submit validation for the order ticket. Returns an empty string
// when the order is valid, or a short user-facing message describing what to fix.
//
// Margin formula: maxLossPerShare * qty / leverage, ceiling-rounded. This
// mirrors the server-side requiredMargin calculation so the client can reject
// impossible orders before they hit the network.
export function ticketValidationMessage({ type, side, price, qty, leverage, available }) {
  if (qty < 1) return 'Enter a quantity of at least 1.';
  if (type === 'limit' && (price < 1 || price > 99)) {
    return 'Price must be between 1¢ and 99¢.';
  }
  const maxLossPerShare = side === 'buy' ? price : 100 - price;
  const margin = Math.ceil((maxLossPerShare * qty) / leverage);
  if (margin > available) {
    return `That needs ${margin} points of margin — you have ${available}.`;
  }
  return '';
}

// Map a failed POST /exchange/orders response to a specific, friendly message.
// Mirrors predictionErrorMessage in spirit but covers exchange-specific errors.
export function exchangeOrderErrorMessage(status, payload = {}) {
  if (status === 401) return 'Your session expired. Please sign in again.';
  const error = String(payload.error || '');
  if (error === 'insufficient_margin') return 'Not enough points for that margin. Lower the size or raise leverage.';
  if (error === 'leverage_too_high') return 'That leverage is too high for this price. Lower it.';
  if (error === 'invalid_leverage') return 'That leverage is not allowed here.';
  if (error === 'market_not_open') return 'This market is closed.';
  if (error === 'short_not_allowed') return "You can't short here.";
  return "Couldn't place your order. Try again.";
}

// Summarize an open position for the position panel. Returns a flat object of
// pre-formatted display strings so the component stays logic-free.
export function positionSummary(pos) {
  if (!pos || pos.shares === 0) return { sideLabel: 'No position' };
  return {
    sideLabel: pos.shares > 0 ? 'Long YES' : 'Short YES',
    sharesLabel: `${Math.abs(pos.shares)} shares @ ${Math.round(pos.avgEntry)}¢`,
    leverageLabel: `${pos.leverage}×`,
    pnlLabel: (pos.unrealizedPnl >= 0 ? '+' : '') + Math.round(pos.unrealizedPnl),
    liquidationLabel: pos.liquidationPrice == null ? 'Liq —' : `Liq ${Math.round(pos.liquidationPrice)}¢`,
  };
}

// Build the POST body for placing an order from the current ticket state. Price
// is explicitly null for market orders so the server doesn't misread an
// uninitialized field as a limit price.
export function placeOrderBody(t) {
  return {
    side: t.side,
    type: t.type,
    price: t.type === 'market' ? null : t.price,
    qty: t.qty,
    leverage: t.leverage,
  };
}
