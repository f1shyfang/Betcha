// Pure bot market-maker quoter. Fair value starts at the creator seed and
// converges fully to the discovered mark as cumulative volume grows (the seed
// weight decays to 0). The quoter posts a ladder of bids/asks around fair value
// at a fixed spread, skewed by inventory (long -> lower prices to shed risk),
// and withdraws the accumulating side entirely once a hard inventory cap is hit.
// Pure: returns the DESIRED order set; posting/cancelling is a side effect
// handled by the bot driver in a later plan.

function clampPrice(p) {
  return Math.max(1, Math.min(99, Math.round(p)));
}

// Seed weight w = 1 / (1 + volume/scale): 1 at zero volume, -> 0 as volume grows.
function convergedFairValue({ seed, mark, volume, scale }) {
  const w = 1 / (1 + volume / scale);
  return (1 - w) * mark + w * seed;
}

function desiredQuotes({ fairValue, inventory, spread, levels, sizePerLevel, maxInventory, skewPerShare = 0 }) {
  const center = fairValue - inventory * skewPerShare;
  const half = spread / 2;
  const atLongCap = inventory >= maxInventory;   // stop buying
  const atShortCap = inventory <= -maxInventory; // stop selling
  const quotes = [];

  for (let i = 0; i < levels; i++) {
    if (!atLongCap) quotes.push({ side: 'buy', price: clampPrice(center - half - i), qty: sizePerLevel });
  }
  for (let i = 0; i < levels; i++) {
    if (!atShortCap) quotes.push({ side: 'sell', price: clampPrice(center + half + i), qty: sizePerLevel });
  }
  return quotes;
}

module.exports = { convergedFairValue, desiredQuotes };
