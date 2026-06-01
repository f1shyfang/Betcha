import { useState, useEffect, useRef, useCallback } from 'react';
import { authClient } from '../lib/authClient';
import {
  formatCents,
  leveragePresets,
  ticketValidationMessage,
  exchangeOrderErrorMessage,
  placeOrderBody,
} from '../lib/exchangeView';
import { shouldPoll } from '../lib/predictionForm';
import {
  priceSeries,
  depthRows,
  botStatusLines,
  eventFeed,
} from '../lib/proView';

// ─── View tab bar ─────────────────────────────────────────────────────────────

const VIEW_TABS = ['Price', 'Depth', 'Bot', 'Events'];

function ViewSwitcher({ active, onChange }) {
  const tabRefs = useRef([]);

  const handleKeyDown = (e, index) => {
    let next = index;
    if (e.key === 'ArrowRight') next = (index + 1) % VIEW_TABS.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + VIEW_TABS.length) % VIEW_TABS.length;
    else return;
    e.preventDefault();
    onChange(VIEW_TABS[next]);
    tabRefs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Pro view panels"
      style={{
        display: 'flex',
        gap: '2px',
        background: 'var(--surface-2)',
        borderRadius: '12px',
        padding: '3px',
      }}
    >
      {VIEW_TABS.map((t, i) => (
        <button
          key={t}
          ref={(el) => { tabRefs.current[i] = el; }}
          role="tab"
          id={`pro-tab-${t.toLowerCase()}`}
          aria-selected={active === t}
          aria-controls={`pro-panel-${t.toLowerCase()}`}
          tabIndex={active === t ? 0 : -1}
          onClick={() => onChange(t)}
          onKeyDown={(e) => handleKeyDown(e, i)}
          style={{
            flex: 1,
            minHeight: 34,
            border: 0,
            borderRadius: '10px',
            background: active === t ? 'var(--surface)' : 'transparent',
            boxShadow: active === t ? '0 1px 6px rgba(18,20,23,0.08)' : 'none',
            color: active === t ? 'var(--ink)' : 'var(--muted)',
            fontFamily: "'Cabinet Grotesk', sans-serif",
            fontSize: '13px',
            fontWeight: active === t ? 700 : 500,
            cursor: 'pointer',
            transition: 'background 150ms ease, color 150ms ease',
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

// ─── Price Chart (lightweight-charts v5) ─────────────────────────────────────

function PriceChart({ history, mark }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  const series = priceSeries(history);
  const isEmpty = series.line.length < 1;

  useEffect(() => {
    if (isEmpty || !containerRef.current) return;

    let chart = null;
    let resizeObserver = null;
    let cancelled = false;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    import('lightweight-charts').then((mod) => {
      if (cancelled || !containerRef.current) return;
      const { createChart, LineSeries, AreaSeries, createSeriesMarkers } = mod;

      chart = createChart(containerRef.current, {
        width: containerRef.current.offsetWidth,
        height: 260,
        layout: {
          background: { color: 'transparent' },
          textColor: '#888',
          fontFamily: "'Geist', sans-serif",
        },
        grid: {
          vertLines: { color: 'rgba(198,205,209,0.15)' },
          horzLines: { color: 'rgba(198,205,209,0.15)' },
        },
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor: 'rgba(198,205,209,0.3)' },
        timeScale: {
          borderColor: 'rgba(198,205,209,0.3)',
          timeVisible: true,
          secondsVisible: false,
          fixLeftEdge: false,
          fixRightEdge: true,
        },
        handleScroll: !prefersReducedMotion,
        handleScale: !prefersReducedMotion,
      });

      chartRef.current = chart;

      // Main price area series
      const mainSeries = chart.addSeries(AreaSeries, {
        lineColor: '#FF5A5F',
        topColor: 'rgba(255,90,95,0.18)',
        bottomColor: 'rgba(255,90,95,0.0)',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      if (series.line.length > 0) mainSeries.setData(series.line);
      if (series.markers.length > 0) createSeriesMarkers(mainSeries, series.markers);

      // Bot band: faint bid line
      if (series.bid.length > 0) {
        const bidSeries = chart.addSeries(LineSeries, {
          color: 'rgba(0,194,168,0.35)',
          lineWidth: 1,
          lineStyle: 2, // dashed
          priceLineVisible: false,
          lastValueVisible: false,
        });
        bidSeries.setData(series.bid);
      }

      // Bot band: faint ask line
      if (series.ask.length > 0) {
        const askSeries = chart.addSeries(LineSeries, {
          color: 'rgba(232,77,77,0.3)',
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        askSeries.setData(series.ask);
      }

      chart.timeScale().fitContent();

      // Resize observer to handle container width changes
      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry || !chart) return;
        const w = entry.contentRect.width;
        chart.applyOptions({ width: w });
      });
      resizeObserver.observe(containerRef.current);
    });

    return () => {
      cancelled = true;
      if (resizeObserver) resizeObserver.disconnect();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  // Re-run only when history data reference changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, isEmpty]);

  const ariaLabel = `Price chart${mark != null ? `, currently ${formatCents(mark)}` : ''}`;

  if (isEmpty) {
    return (
      <div
        style={{
          height: 260,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--surface-2)',
          borderRadius: '12px',
          color: 'var(--muted)',
          fontSize: '14px',
        }}
        aria-label={ariaLabel}
      >
        No trades yet — chart will appear once the first fill happens.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      aria-label={ariaLabel}
      style={{ borderRadius: '12px', overflow: 'hidden', width: '100%' }}
    />
  );
}

// ─── Depth Chart (hand-rolled SVG) ────────────────────────────────────────────

function DepthChart({ book }) {
  const { bids, asks, maxCum } = depthRows(book);
  const W = 400;
  const H = 200;
  const cx = W / 2;
  const BAR_H = 14;
  const GAP = 3;
  const LABEL_W = 46;

  const allRows = [
    ...asks.slice().reverse(), // lowest ask at center
    ...bids, // highest bid at center
  ];

  if (allRows.length === 0) {
    return (
      <div
        style={{
          height: 200,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--surface-2)',
          borderRadius: '12px',
          color: 'var(--muted)',
          fontSize: '14px',
        }}
      >
        No orders in the book.
      </div>
    );
  }

  const maxRows = Math.floor(H / (BAR_H + GAP));
  const visibleBids = bids.slice(0, Math.floor(maxRows / 2));
  const visibleAsks = asks.slice(0, Math.floor(maxRows / 2)).reverse();

  const totalRows = visibleBids.length + visibleAsks.length;
  const svgH = Math.max(80, totalRows * (BAR_H + GAP) + GAP * 2);

  const safeMax = maxCum > 0 ? maxCum : 1;

  function renderRows(rows, isBid, startY) {
    return rows.map((row, i) => {
      const barW = Math.max(4, ((row.cum / safeMax) * (cx - LABEL_W - 4)));
      const botW = row.cum > 0 ? (row.cumBot / row.cum) * barW : 0;
      const y = startY + i * (BAR_H + GAP);

      const barX = isBid ? cx - barW : cx;
      const botBarX = isBid ? cx - botW : cx;

      const labelX = isBid ? cx - barW - 2 : cx + barW + 2;
      const labelAnchor = isBid ? 'end' : 'start';

      const color = isBid ? 'rgba(0,194,168,0.25)' : 'rgba(255,90,95,0.22)';
      const botColor = '#00C2A8';

      return (
        <g key={`${isBid ? 'b' : 'a'}-${i}`}>
          {/* full bar */}
          <rect x={barX} y={y} width={barW} height={BAR_H} fill={color} rx={3} />
          {/* bot portion overlay */}
          {botW > 0 && (
            <rect x={botBarX} y={y} width={botW} height={BAR_H} fill={botColor} opacity={0.55} rx={3} />
          )}
          {/* price label */}
          <text
            x={cx + (isBid ? -4 : 4)}
            y={y + BAR_H / 2 + 1}
            textAnchor={isBid ? 'end' : 'start'}
            dominantBaseline="middle"
            fontSize={11}
            fontFamily="'Geist', sans-serif"
            fill={isBid ? '#0d6b60' : '#E84D4D'}
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {row.price}¢
          </text>
          {/* cumulative label */}
          <text
            x={labelX}
            y={y + BAR_H / 2 + 1}
            textAnchor={labelAnchor}
            dominantBaseline="middle"
            fontSize={10}
            fontFamily="'Geist', sans-serif"
            fill="#888"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {row.cum}
          </text>
        </g>
      );
    });
  }

  const askStartY = GAP;
  const bidStartY = visibleAsks.length * (BAR_H + GAP) + GAP;

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${svgH}`}
        aria-label="Depth chart — bids left, asks right"
        style={{ display: 'block', fontFamily: "'Geist', sans-serif" }}
      >
        {/* Center line */}
        <line x1={cx} y1={0} x2={cx} y2={svgH} stroke="var(--border)" strokeWidth={1} />
        {/* Header labels */}
        <text x={cx - 8} y={svgH - 4} textAnchor="end" fontSize={10} fill="#888">Bids</text>
        <text x={cx + 8} y={svgH - 4} textAnchor="start" fontSize={10} fill="#888">Asks</text>
        {renderRows(visibleBids, true, bidStartY)}
        {renderRows(visibleAsks, false, askStartY)}
      </svg>
      {/* Legend */}
      <div style={{ display: 'flex', gap: '16px', marginTop: '6px', fontSize: '11px', color: 'var(--muted)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: '#00C2A8', opacity: 0.8, display: 'inline-block' }} />
          Bot qty
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(0,194,168,0.25)', display: 'inline-block' }} />
          Human bid
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(255,90,95,0.22)', display: 'inline-block' }} />
          Human ask
        </span>
      </div>
    </div>
  );
}

// ─── Bot Status ───────────────────────────────────────────────────────────────

function BotStatus({ bot }) {
  const { inventoryLabel, fairValueLabel, quoteLabel, spreadLabel, capLabel, capPct } = botStatusLines(bot);

  const rows = [
    { label: 'Inventory', value: inventoryLabel },
    { label: 'Fair value', value: fairValueLabel },
    { label: 'Quote', value: quoteLabel },
    { label: 'Spread', value: spreadLabel },
  ];

  return (
    <div style={{ display: 'grid', gap: '10px' }}>
      {rows.map(({ label, value }) => (
        <div
          key={label}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 12px',
            background: 'var(--surface-2)',
            borderRadius: '10px',
            fontSize: '13px',
          }}
        >
          <span style={{ color: 'var(--muted)', fontFamily: "'Cabinet Grotesk', sans-serif", fontWeight: 600 }}>
            {label}
          </span>
          <span
            style={{
              fontFamily: "'Geist', sans-serif",
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 600,
              color: 'var(--ink)',
            }}
          >
            {value}
          </span>
        </div>
      ))}

      {/* Cap usage bar */}
      <div style={{ padding: '8px 12px', background: 'var(--surface-2)', borderRadius: '10px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '12px',
            color: 'var(--muted)',
            fontFamily: "'Cabinet Grotesk', sans-serif",
            fontWeight: 600,
            marginBottom: '6px',
          }}
        >
          <span>Cap used — {capLabel}</span>
          <span
            style={{ fontFamily: "'Geist', sans-serif", fontVariantNumeric: 'tabular-nums', color: 'var(--ink)' }}
          >
            {capPct}%
          </span>
        </div>
        <div
          style={{
            height: 6,
            background: 'var(--border)',
            borderRadius: 9999,
            overflow: 'hidden',
          }}
          aria-label={`Bot cap usage: ${capLabel} (${capPct}%)`}
          role="meter"
          aria-valuenow={capPct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            style={{
              width: `${capPct}%`,
              height: '100%',
              background: '#00C2A8',
              borderRadius: 9999,
              transition: 'width 300ms ease',
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Event Feed ───────────────────────────────────────────────────────────────

function EventFeed({ recentOrders, trades }) {
  const events = eventFeed(recentOrders, trades, { limit: 20 });

  if (events.length === 0) {
    return (
      <p style={{ color: 'var(--muted)', fontSize: '14px', margin: '16px 0' }}>
        No activity yet.
      </p>
    );
  }

  const typeStyle = {
    fill: { color: '#0d6b60', bg: 'rgba(0,194,168,0.1)', label: 'Fill' },
    bot_requote: { color: '#4D9AFE', bg: 'rgba(77,154,254,0.1)', label: 'Bot' },
    human_order: { color: 'var(--ink)', bg: 'var(--surface-2)', label: 'Order' },
    bot_order: { color: '#4D9AFE', bg: 'rgba(77,154,254,0.1)', label: 'Bot' },
  };

  return (
    <ul
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '3px', maxHeight: 320, overflowY: 'auto' }}
      aria-label="Event feed"
    >
      {events.map((ev, i) => {
        const ts = typeStyle[ev.kind] || typeStyle.human_order;
        const timeStr = ev.at
          ? new Date(ev.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : '';
        return (
          <li
            key={`${ev.kind}-${ev.at}-${i}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '5px 8px',
              borderRadius: '8px',
              background: 'var(--surface-2)',
              fontSize: '12px',
              fontFamily: "'Geist', sans-serif",
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <span
              style={{
                padding: '1px 6px',
                borderRadius: '999px',
                background: ts.bg,
                color: ts.color,
                fontSize: '11px',
                fontWeight: 700,
                flexShrink: 0,
                fontFamily: "'Cabinet Grotesk', sans-serif",
              }}
            >
              {ts.label}
            </span>
            <span style={{ flex: 1, color: 'var(--ink)' }}>{ev.label}</span>
            <span style={{ color: 'var(--muted)', fontSize: '11px', flexShrink: 0 }}>{timeStr}</span>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Compact Order Ticket ─────────────────────────────────────────────────────

function CompactOrderTicket({ marketId, maxLeverage, bestBid, bestAsk, onOrderSuccess }) {
  const [side, setSide] = useState('buy');
  const [type, setType] = useState('limit');
  const [price, setPrice] = useState(50);
  const [qty, setQty] = useState(1);
  const [leverage, setLeverage] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [orderError, setOrderError] = useState('');
  const [orderSuccess, setOrderSuccess] = useState(false);

  const presets = leveragePresets(maxLeverage || 10);

  const validationMsg = ticketValidationMessage({
    type,
    side,
    price,
    qty,
    leverage,
    available: Infinity,
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (validationMsg) return;
    setOrderError('');
    setOrderSuccess(false);
    setSubmitting(true);

    const iKey = `exch-pro-${marketId}-${side}-${type}-${price}-${qty}-${leverage}-${Date.now()}`;

    try {
      const { data: sess } = await authClient.getSession();
      if (!sess?.session) {
        setOrderError('Your session expired. Please sign in again.');
        return;
      }

      const body = placeOrderBody({ side, type, price, qty, leverage });
      const res = await fetch(`/api/markets/${marketId}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'idempotency-key': iKey,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setOrderError(exchangeOrderErrorMessage(res.status, payload));
        return;
      }

      setOrderSuccess(true);
      setTimeout(() => setOrderSuccess(false), 2000);
      onOrderSuccess();
    } catch {
      setOrderError("Couldn't place your order. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle = {
    width: '100%',
    minHeight: 38,
    padding: '7px 10px',
    borderRadius: '10px',
    border: '1px solid var(--border)',
    fontSize: '14px',
    background: 'var(--surface)',
    color: 'var(--ink)',
    fontFamily: "'Geist', sans-serif",
    fontVariantNumeric: 'tabular-nums',
    boxSizing: 'border-box',
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '10px' }}>
      {/* Best bid/ask display */}
      {(bestBid != null || bestAsk != null) && (
        <div
          style={{
            display: 'flex',
            gap: '12px',
            padding: '6px 10px',
            background: 'var(--surface-2)',
            borderRadius: '8px',
            fontSize: '12px',
            fontFamily: "'Geist', sans-serif",
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <span>
            <span style={{ color: 'var(--muted)', fontWeight: 600 }}>Bid </span>
            <span style={{ color: '#0d6b60', fontWeight: 700 }}>{bestBid != null ? `${bestBid}¢` : '—'}</span>
          </span>
          <span>
            <span style={{ color: 'var(--muted)', fontWeight: 600 }}>Ask </span>
            <span style={{ color: '#E84D4D', fontWeight: 700 }}>{bestAsk != null ? `${bestAsk}¢` : '—'}</span>
          </span>
        </div>
      )}

      {/* Side toggle */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }} role="group" aria-label="Order side">
        <button
          type="button"
          aria-pressed={side === 'buy'}
          onClick={() => setSide('buy')}
          style={{
            minHeight: 38,
            borderRadius: '10px',
            border: '2px solid',
            borderColor: side === 'buy' ? 'var(--secondary)' : 'var(--border)',
            background: side === 'buy' ? 'rgba(0,194,168,0.1)' : 'var(--surface)',
            color: side === 'buy' ? '#0d6b60' : 'var(--ink)',
            fontFamily: "'Cabinet Grotesk', sans-serif",
            fontSize: '14px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Buy YES
        </button>
        <button
          type="button"
          aria-pressed={side === 'sell'}
          onClick={() => setSide('sell')}
          style={{
            minHeight: 38,
            borderRadius: '10px',
            border: '2px solid',
            borderColor: side === 'sell' ? 'var(--primary)' : 'var(--border)',
            background: side === 'sell' ? 'rgba(255,90,95,0.1)' : 'var(--surface)',
            color: side === 'sell' ? '#E84D4D' : 'var(--ink)',
            fontFamily: "'Cabinet Grotesk', sans-serif",
            fontSize: '14px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Sell / Short
        </button>
      </div>

      {/* Limit / Market row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }} role="group" aria-label="Order type">
        {['limit', 'market'].map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={type === t}
            onClick={() => setType(t)}
            style={{
              minHeight: 34,
              borderRadius: '999px',
              border: '1px solid',
              borderColor: type === t ? 'var(--ink)' : 'var(--border)',
              background: type === t ? 'var(--ink)' : 'var(--surface)',
              color: type === t ? '#fff' : 'var(--ink)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Price + qty in a row for compactness */}
      <div style={{ display: 'grid', gridTemplateColumns: type === 'limit' ? '1fr 1fr' : '1fr', gap: '8px' }}>
        {type === 'limit' && (
          <label style={{ display: 'grid', gap: '4px', fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>
            Price (¢)
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={99}
              step={1}
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
              style={inputStyle}
              aria-label="Limit price in cents"
            />
          </label>
        )}
        <label style={{ display: 'grid', gap: '4px', fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>
          Qty
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            style={inputStyle}
            aria-label="Quantity in shares"
          />
        </label>
      </div>

      {/* Leverage chips */}
      <div>
        <div
          style={{
            fontSize: '11px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--muted)',
            marginBottom: '6px',
          }}
        >
          Leverage
        </div>
        <div role="group" aria-label="Leverage presets" style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {presets.map((lv) => (
            <button
              key={lv}
              type="button"
              aria-pressed={leverage === lv}
              onClick={() => setLeverage(lv)}
              style={{
                minHeight: 30,
                padding: '4px 10px',
                borderRadius: '999px',
                border: '1px solid',
                borderColor: leverage === lv ? 'var(--primary)' : 'var(--border)',
                background: leverage === lv ? 'rgba(255,90,95,0.1)' : 'var(--surface)',
                color: leverage === lv ? '#E84D4D' : 'var(--ink)',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: "'Geist', sans-serif",
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {lv}×
            </button>
          ))}
        </div>
      </div>

      {validationMsg && (
        <p role="alert" style={{ margin: 0, fontSize: '12px', color: '#E84D4D' }}>
          {validationMsg}
        </p>
      )}

      <button
        type="submit"
        className="button"
        disabled={submitting || !!validationMsg}
        style={{ width: '100%', minHeight: 40 }}
      >
        {submitting
          ? 'Placing…'
          : side === 'buy'
          ? `Buy YES${type === 'limit' ? ` @ ${price}¢` : ''}`
          : `Sell / Short${type === 'limit' ? ` @ ${price}¢` : ''}`}
      </button>

      {orderError && (
        <div className="message error" role="alert">
          {orderError}
        </div>
      )}
      {orderSuccess && (
        <div className="message success" role="status">
          Order placed.
        </div>
      )}
    </form>
  );
}

// ─── Main ProMarketView ────────────────────────────────────────────────────────

export default function ProMarketView({ marketId, market }) {
  const [state, setState] = useState(null);
  const [history, setHistory] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [activeTab, setActiveTab] = useState('Price');
  const submittingRef = useRef(false);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`/api/markets/${marketId}/exchange-state`);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setLoadError(payload.error || 'Failed to load exchange data.');
        return;
      }
      const data = await res.json();
      setState(data);
      setLoadError('');
    } catch {
      setLoadError('Connection error — retrying…');
    }
  }, [marketId]);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/markets/${marketId}/history`);
      if (res.ok) {
        const data = await res.json();
        setHistory(data);
      }
    } catch {
      // Non-critical — chart just won't render
    }
  }, [marketId]);

  // Initial loads + poll
  useEffect(() => {
    if (!marketId) return;
    fetchState();
    fetchHistory();

    const pollTimer = setInterval(() => {
      if (shouldPoll(document.hidden, submittingRef.current)) {
        fetchState();
      }
    }, 2500);

    const historyTimer = setInterval(() => {
      if (shouldPoll(document.hidden, false)) {
        fetchHistory();
      }
    }, 15000);

    const onVisible = () => {
      if (!document.hidden) {
        fetchState();
        fetchHistory();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(pollTimer);
      clearInterval(historyTimer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [marketId, fetchState, fetchHistory]);

  const handleOrderSuccess = () => {
    fetchState();
  };

  const mark = state?.mark ?? null;
  const maxLeverage = market?.max_leverage ?? 10;
  const bestBid = state?.bot?.bestBid ?? null;
  const bestAsk = state?.bot?.bestAsk ?? null;

  return (
    <div>
      {/* ── Mark price bar ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          marginBottom: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            fontFamily: "'Geist', sans-serif",
            fontVariantNumeric: 'tabular-nums',
            fontSize: '28px',
            fontWeight: 700,
            color: 'var(--ink)',
            letterSpacing: '-0.03em',
          }}
          aria-label={`Mark price: ${formatCents(mark)}`}
        >
          {formatCents(mark)}
        </div>
        {state?.bot && (
          <div
            style={{
              display: 'flex',
              gap: '10px',
              fontSize: '13px',
              fontFamily: "'Geist', sans-serif",
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <span>
              <span style={{ color: 'var(--muted)' }}>Bid </span>
              <span style={{ color: '#0d6b60', fontWeight: 700 }}>{bestBid != null ? `${bestBid}¢` : '—'}</span>
            </span>
            <span>
              <span style={{ color: 'var(--muted)' }}>Ask </span>
              <span style={{ color: '#E84D4D', fontWeight: 700 }}>{bestAsk != null ? `${bestAsk}¢` : '—'}</span>
            </span>
          </div>
        )}
        {loadError && (
          <p style={{ margin: 0, fontSize: '12px', color: '#E84D4D' }} role="alert">
            {loadError}
          </p>
        )}
      </div>

      {/* ── Main two-column layout ── */}
      <div
        className="pro-layout"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 280px',
          gap: '12px',
          alignItems: 'start',
        }}
      >
        {/* Left: chart / panel area */}
        <div style={{ display: 'grid', gap: '10px' }}>
          <ViewSwitcher active={activeTab} onChange={setActiveTab} />

          <section
            id={`pro-panel-${activeTab.toLowerCase()}`}
            role="tabpanel"
            aria-labelledby={`pro-tab-${activeTab.toLowerCase()}`}
            className="prediction-section"
            style={{ padding: '14px' }}
          >
            {activeTab === 'Price' && (
              <PriceChart history={history} mark={mark} />
            )}
            {activeTab === 'Depth' && (
              <DepthChart book={state?.book} />
            )}
            {activeTab === 'Bot' && (
              <BotStatus bot={state?.bot} />
            )}
            {activeTab === 'Events' && (
              <EventFeed
                recentOrders={state?.recentOrders ?? []}
                trades={state?.trades ?? []}
              />
            )}
          </section>
        </div>

        {/* Right: compact order ticket docked */}
        <section
          className="prediction-section"
          aria-label="Order ticket"
          style={{ padding: '14px' }}
        >
          <div
            style={{
              fontSize: '12px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              color: 'var(--muted)',
              marginBottom: '10px',
              fontFamily: "'Cabinet Grotesk', sans-serif",
            }}
          >
            Place Order
          </div>
          <CompactOrderTicket
            marketId={marketId}
            maxLeverage={maxLeverage}
            bestBid={bestBid}
            bestAsk={bestAsk}
            onOrderSuccess={handleOrderSuccess}
          />
        </section>
      </div>

      {/* Responsive: stack on narrow viewports */}
      <style>{`
        @media (max-width: 720px) {
          .pro-layout { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
