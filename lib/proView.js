// Pure view helpers for the "pro" market-detail view: chart series, depth rows,
// bot status panel, and the event-feed log. Framework-free so they can be
// unit-tested without a DOM.

/**
 * Convert a millisecond timestamp, ISO string, or Date to integer Unix seconds.
 * Used by lightweight-charts which expects second-precision timestamps.
 */
export function toUnixSeconds(at) {
  return Math.floor(new Date(at).getTime() / 1000);
}

/**
 * Build chart series objects from market history data.
 *
 * Returns:
 *   line    – [{time, value}] price line, ascending, deduped (last value wins)
 *   bid     – [{time, value}] bot bid band, ascending, deduped
 *   ask     – [{time, value}] bot ask band, ascending, deduped
 *   markers – [{time, position, color, shape, text}] trade markers
 *
 * Dedup strategy: build a Map keyed by time; iterate input in order so later
 * entries overwrite earlier ones; then sort the Map's values by time ascending.
 */
export function priceSeries({ prices = [], botBand = [], botMarkers = [] } = {}) {
  function dedupedSeries(items, toEntry) {
    const map = new Map();
    for (const item of items) {
      const entry = toEntry(item);
      map.set(entry.time, entry);
    }
    return [...map.values()].sort((a, b) => a.time - b.time);
  }

  const line = dedupedSeries(prices, (p) => ({ time: toUnixSeconds(p.at), value: p.price }));
  const bid  = dedupedSeries(botBand, (b) => ({ time: toUnixSeconds(b.at), value: b.bid }));
  const ask  = dedupedSeries(botBand, (b) => ({ time: toUnixSeconds(b.at), value: b.ask }));

  const markers = botMarkers.map((m) => ({
    time:     toUnixSeconds(m.at),
    position: m.side === 'sell' ? 'aboveBar' : 'belowBar',
    color:    '#00C2A8',
    shape:    m.side === 'sell' ? 'arrowDown' : 'arrowUp',
    text:     '',
  }));

  return { line, bid, ask, markers };
}

/**
 * Build depth-chart rows from an order-book snapshot.
 *
 * Bids are sorted by price DESC (best bid first, i.e. closest to mid).
 * Asks are sorted by price ASC (best ask first, i.e. closest to mid).
 * Both accumulate cum and cumBot walking outward from the mid.
 *
 * Returns { bids, asks, maxCum } where maxCum is the larger of the two sides'
 * total cumulative quantities — useful for normalising the depth bar widths.
 */
export function depthRows({ bids = [], asks = [] } = {}) {
  function accumulate(levels) {
    let cum    = 0;
    let cumBot = 0;
    return levels.map((row) => {
      cum    += row.qty;
      cumBot += row.botQty ?? 0;
      return { ...row, cum, cumBot };
    });
  }

  const sortedBids = [...bids].sort((a, b) => b.price - a.price);
  const sortedAsks = [...asks].sort((a, b) => a.price - b.price);

  const accBids = accumulate(sortedBids);
  const accAsks = accumulate(sortedAsks);

  const lastBidCum = accBids.length ? accBids[accBids.length - 1].cum : 0;
  const lastAskCum = accAsks.length ? accAsks[accAsks.length - 1].cum : 0;
  const maxCum = Math.max(lastBidCum, lastAskCum);

  return { bids: accBids, asks: accAsks, maxCum };
}

/**
 * Format the bot-status panel fields from a bot-state snapshot.
 *
 * All label strings are pre-formatted so the component stays logic-free.
 */
export function botStatusLines(bot = {}) {
  const inv = bot.inventory ?? 0;

  let inventoryLabel;
  if (inv > 0)      inventoryLabel = `+${inv} YES`;
  else if (inv < 0) inventoryLabel = `${inv} short`;
  else              inventoryLabel = 'flat';

  const fairValueLabel =
    bot.fairValue != null ? `${bot.fairValue}¢` : '—';

  const quoteLabel =
    bot.bestBid != null && bot.bestAsk != null
      ? `${bot.bestBid}¢ / ${bot.bestAsk}¢`
      : '—';

  const spreadLabel =
    bot.spread != null ? `${bot.spread}¢ spread` : '—';

  const capLabel = `${Math.abs(inv)} / ${bot.maxInventory}`;
  const capPct   = bot.capUsedPct ?? 0;

  return { inventoryLabel, fairValueLabel, quoteLabel, spreadLabel, capLabel, capPct };
}

/**
 * Build the event-feed log rows shown below the chart.
 *
 * Sources merged (all times in milliseconds, sorted DESC):
 *   trades       → kind:'fill',        label:'Filled N @ P¢'
 *   bot orders   → kind:'bot_requote', grouped by timestamp batch; one row per
 *                  batch, label:'Bot re-quoted around M¢'
 *   human orders → kind:'human_order', label:'status side qty @ price¢'
 */
export function eventFeed(recentOrders = [], trades = [], { limit = 20 } = {}) {
  const rows = [];

  // Fills from trades
  for (const t of trades) {
    rows.push({
      kind:  'fill',
      at:    new Date(t.at).getTime(),
      label: `Filled ${t.qty} @ ${t.price}¢`,
    });
  }

  // Separate bot vs human orders
  const botOrders   = recentOrders.filter((o) => o.isBot);
  const humanOrders = recentOrders.filter((o) => !o.isBot);

  // Group bot orders by their exact millisecond timestamp → one requote row per batch
  const botBatches = new Map();
  for (const o of botOrders) {
    const ms = new Date(o.at).getTime();
    if (!botBatches.has(ms)) botBatches.set(ms, []);
    botBatches.get(ms).push(o);
  }

  for (const [ms, batch] of botBatches) {
    const buyPrices  = batch.filter((o) => o.side === 'buy').map((o) => o.price);
    const sellPrices = batch.filter((o) => o.side === 'sell').map((o) => o.price);

    let mid;
    if (buyPrices.length && sellPrices.length) {
      mid = Math.round((Math.max(...buyPrices) + Math.min(...sellPrices)) / 2);
    } else {
      const allPrices = batch.map((o) => o.price);
      mid = Math.round(allPrices.reduce((a, b) => a + b, 0) / allPrices.length);
    }

    rows.push({
      kind:  'bot_requote',
      at:    ms,
      label: `Bot re-quoted around ${mid}¢`,
    });
  }

  // Human order rows
  for (const o of humanOrders) {
    rows.push({
      kind:  'human_order',
      at:    new Date(o.at).getTime(),
      label: `${o.status} ${o.side} ${o.qty} @ ${o.price}¢`,
    });
  }

  // Sort DESC by time, then limit
  rows.sort((a, b) => b.at - a.at);
  return rows.slice(0, limit);
}
