import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import { authClient } from '../lib/authClient';
import {
  formatCents,
  probabilityLabel,
  ladderRows,
  leveragePresets,
  ticketValidationMessage,
  exchangeOrderErrorMessage,
  positionSummary,
  placeOrderBody,
} from '../lib/exchangeView';
import { shouldPoll } from '../lib/predictionForm';
import ProMarketView from './ProMarketView';

// ─── Sparkline ──────────────────────────────────────────────────────────────

function Sparkline({ prices }) {
  if (!prices || prices.length < 2) return null;
  const W = 120;
  const H = 32;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const pts = prices
    .map((p, i) => {
      const x = (i / (prices.length - 1)) * W;
      const y = H - ((p - min) / range) * (H - 4) - 2;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden="true"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <polyline
        points={pts}
        fill="none"
        stroke="var(--secondary)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── Order Book Ladder ────────────────────────────────────────────────────────

function OrderBook({ book }) {
  const { asks, bids } = ladderRows(book || { asks: [], bids: [] }, 6);

  const bestAsk = asks.length ? asks[asks.length - 1].price : null;
  const bestBid = bids.length ? bids[0].price : null;
  const mid =
    bestAsk != null && bestBid != null ? Math.round((bestAsk + bestBid) / 2) : null;
  const spread =
    bestAsk != null && bestBid != null ? bestAsk - bestBid : null;

  const rowStyle = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: '4px',
    padding: '4px 8px',
    fontSize: '13px',
    fontFamily: "'Geist', sans-serif",
    fontVariantNumeric: 'tabular-nums',
    borderRadius: '6px',
  };

  return (
    <div>
      {/* header */}
      <div
        style={{
          ...rowStyle,
          color: 'var(--muted)',
          fontSize: '11px',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: '4px',
        }}
      >
        <span>Price</span>
        <span style={{ textAlign: 'right' }}>Qty</span>
        <span style={{ textAlign: 'right' }}>Depth</span>
      </div>

      {/* asks (high→low, i.e. best ask at bottom) */}
      {asks.map((row, i) => (
        <div
          key={`ask-${i}`}
          style={{
            ...rowStyle,
            background: 'rgba(255,90,95,0.06)',
            marginBottom: '1px',
          }}
        >
          <span style={{ color: '#E84D4D' }}>{formatCents(row.price)}</span>
          <span style={{ textAlign: 'right' }}>{row.qty}</span>
          <span style={{ textAlign: 'right', color: 'var(--muted)' }}>{row.cumulative}</span>
        </div>
      ))}

      {/* spread / mid row */}
      <div
        style={{
          ...rowStyle,
          background: 'var(--surface-2)',
          borderTop: '1px solid var(--border)',
          borderBottom: '1px solid var(--border)',
          color: 'var(--muted)',
          fontSize: '12px',
          margin: '2px 0',
        }}
      >
        <span>Mid {mid != null ? formatCents(mid) : '—'}</span>
        <span style={{ textAlign: 'right', gridColumn: '2 / -1' }}>
          {spread != null ? `Spread ${spread}¢` : 'No spread'}
        </span>
      </div>

      {/* bids (high→low) */}
      {bids.map((row, i) => (
        <div
          key={`bid-${i}`}
          style={{
            ...rowStyle,
            background: 'rgba(0,194,168,0.06)',
            marginBottom: '1px',
          }}
        >
          <span style={{ color: '#0d6b60' }}>{formatCents(row.price)}</span>
          <span style={{ textAlign: 'right' }}>{row.qty}</span>
          <span style={{ textAlign: 'right', color: 'var(--muted)' }}>{row.cumulative}</span>
        </div>
      ))}

      {asks.length === 0 && bids.length === 0 && (
        <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '13px', margin: '16px 0' }}>
          No orders in the book yet.
        </p>
      )}
    </div>
  );
}

// ─── Position Panel ───────────────────────────────────────────────────────────

function PositionPanel({ myPosition }) {
  const pos = positionSummary(myPosition);

  if (pos.sideLabel === 'No position') {
    return (
      <p style={{ color: 'var(--muted)', fontSize: '14px', margin: '16px 0' }}>
        You have no open position on this market.
      </p>
    );
  }

  const pnlColor =
    myPosition && myPosition.unrealizedPnl >= 0 ? '#0d6b60' : '#E84D4D';

  return (
    <div style={{ display: 'grid', gap: '10px' }}>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <span
          style={{
            padding: '4px 10px',
            borderRadius: '999px',
            background: myPosition.shares > 0
              ? 'rgba(0,194,168,0.1)'
              : 'rgba(255,90,95,0.1)',
            color: myPosition.shares > 0 ? '#0d6b60' : '#E84D4D',
            fontFamily: "'Cabinet Grotesk', sans-serif",
            fontWeight: 700,
            fontSize: '13px',
          }}
        >
          {pos.sideLabel}
        </span>
        <span
          style={{
            padding: '4px 10px',
            borderRadius: '999px',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            fontSize: '13px',
            fontFamily: "'Geist', sans-serif",
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {pos.leverageLabel}
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px',
        }}
      >
        {[
          { label: 'Position', value: pos.sharesLabel },
          {
            label: 'Unrealized P&L',
            value: pos.pnlLabel,
            color: pnlColor,
          },
          { label: 'Liquidation', value: pos.liquidationLabel },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '10px 12px',
            }}
          >
            <div
              style={{
                fontSize: '11px',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--muted)',
                marginBottom: '4px',
              }}
            >
              {label}
            </div>
            <div
              style={{
                fontFamily: "'Geist', sans-serif",
                fontVariantNumeric: 'tabular-nums',
                fontSize: '16px',
                fontWeight: 600,
                color: color || 'var(--ink)',
              }}
            >
              {value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Open Orders ──────────────────────────────────────────────────────────────

function OpenOrders({ orders, onCancel }) {
  if (!orders || orders.length === 0) {
    return (
      <p style={{ color: 'var(--muted)', fontSize: '14px', margin: '16px 0' }}>
        No open orders.
      </p>
    );
  }

  return (
    <ul
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '6px' }}
      aria-label="Open orders"
    >
      {orders.map((order) => (
        <li
          key={order.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
            padding: '10px 14px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            fontSize: '13px',
            fontFamily: "'Geist', sans-serif",
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <span
            style={{
              fontFamily: "'Cabinet Grotesk', sans-serif",
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '999px',
              background:
                order.side === 'buy'
                  ? 'rgba(0,194,168,0.1)'
                  : 'rgba(255,90,95,0.1)',
              color: order.side === 'buy' ? '#0d6b60' : '#E84D4D',
              fontSize: '12px',
            }}
          >
            {order.side === 'buy' ? 'Buy YES' : 'Sell / Short'}
          </span>
          <span>
            {formatCents(order.price)} × {order.qty}
          </span>
          <span style={{ color: 'var(--muted)', flex: 1 }}>{order.status}</span>
          <button
            type="button"
            className="button button-secondary button-sm"
            style={{ padding: '4px 12px', minHeight: 32, fontSize: '12px' }}
            onClick={() => onCancel(order.id)}
            aria-label={`Cancel ${order.side} ${order.qty} at ${formatCents(order.price)}`}
          >
            Cancel
          </button>
        </li>
      ))}
    </ul>
  );
}

// ─── Order Ticket ─────────────────────────────────────────────────────────────

function OrderTicket({ marketId, maxLeverage, onOrderSuccess, submittingRef }) {
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
    if (submittingRef) submittingRef.current = true;

    // Stable idempotency key from the ticket inputs
    const iKey = `exch-${marketId}-${side}-${type}-${price}-${qty}-${leverage}-${Date.now()}`;

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
      if (submittingRef) submittingRef.current = false;
    }
  };

  const inputStyle = {
    width: '100%',
    minHeight: 44,
    padding: '10px 12px',
    borderRadius: '12px',
    border: '1px solid var(--border)',
    fontSize: '16px',
    background: 'var(--surface)',
    color: 'var(--ink)',
    fontFamily: "'Geist', sans-serif",
    fontVariantNumeric: 'tabular-nums',
    boxSizing: 'border-box',
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '14px' }}>
      {/* Buy YES / Sell-Short toggle */}
      <fieldset
        style={{
          border: 0,
          margin: 0,
          padding: 0,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px',
        }}
      >
        <legend
          style={{
            fontSize: '12px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--muted)',
            marginBottom: '8px',
            float: 'left',
            width: '100%',
          }}
        >
          Side
        </legend>
        <button
          type="button"
          aria-pressed={side === 'buy'}
          onClick={() => setSide('buy')}
          style={{
            minHeight: 44,
            borderRadius: '12px',
            border: '2px solid',
            borderColor: side === 'buy' ? 'var(--secondary)' : 'var(--border)',
            background: side === 'buy' ? 'rgba(0,194,168,0.1)' : 'var(--surface)',
            color: side === 'buy' ? '#0d6b60' : 'var(--ink)',
            fontFamily: "'Cabinet Grotesk', sans-serif",
            fontSize: '15px',
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
            minHeight: 44,
            borderRadius: '12px',
            border: '2px solid',
            borderColor: side === 'sell' ? 'var(--primary)' : 'var(--border)',
            background: side === 'sell' ? 'rgba(255,90,95,0.1)' : 'var(--surface)',
            color: side === 'sell' ? '#E84D4D' : 'var(--ink)',
            fontFamily: "'Cabinet Grotesk', sans-serif",
            fontSize: '15px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Sell / Short
        </button>
      </fieldset>

      {/* Limit / Market switch */}
      <fieldset
        style={{
          border: 0,
          margin: 0,
          padding: 0,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px',
        }}
      >
        <legend
          style={{
            fontSize: '12px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--muted)',
            marginBottom: '8px',
            float: 'left',
            width: '100%',
          }}
        >
          Order type
        </legend>
        {['limit', 'market'].map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={type === t}
            onClick={() => setType(t)}
            style={{
              minHeight: 36,
              borderRadius: '999px',
              border: '1px solid',
              borderColor: type === t ? 'var(--ink)' : 'var(--border)',
              background: type === t ? 'var(--ink)' : 'var(--surface)',
              color: type === t ? '#fff' : 'var(--ink)',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {t}
          </button>
        ))}
      </fieldset>

      {/* Price input (limit only) */}
      {type === 'limit' && (
        <label style={{ display: 'grid', gap: '6px', fontSize: '14px', fontWeight: 600 }}>
          Limit price (1–99¢)
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

      {/* Quantity */}
      <label style={{ display: 'grid', gap: '6px', fontSize: '14px', fontWeight: 600 }}>
        Quantity (shares)
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

      {/* Leverage chips */}
      <div>
        <div
          style={{
            fontSize: '12px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--muted)',
            marginBottom: '8px',
          }}
        >
          Leverage
        </div>
        <div
          role="group"
          aria-label="Leverage presets"
          style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}
        >
          {presets.map((lv) => (
            <button
              key={lv}
              type="button"
              aria-pressed={leverage === lv}
              onClick={() => setLeverage(lv)}
              style={{
                minHeight: 36,
                padding: '6px 14px',
                borderRadius: '999px',
                border: '1px solid',
                borderColor: leverage === lv ? 'var(--primary)' : 'var(--border)',
                background: leverage === lv ? 'rgba(255,90,95,0.1)' : 'var(--surface)',
                color: leverage === lv ? '#E84D4D' : 'var(--ink)',
                fontSize: '13px',
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

      {/* Inline validation */}
      {validationMsg && (
        <p
          role="alert"
          style={{ margin: 0, fontSize: '13px', color: '#E84D4D' }}
        >
          {validationMsg}
        </p>
      )}

      {/* Submit */}
      <button
        type="submit"
        className="button"
        disabled={submitting || !!validationMsg}
        style={{ width: '100%' }}
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

// ─── Tab bar ──────────────────────────────────────────────────────────────────

const TABS = ['Book', 'Position', 'Trades'];

function Tabs({ active, onChange }) {
  const tabRefs = useRef([]);

  const handleKeyDown = (e, index) => {
    let next = index;
    if (e.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else return;
    e.preventDefault();
    onChange(TABS[next]);
    tabRefs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Exchange panels"
      style={{
        display: 'flex',
        gap: '2px',
        background: 'var(--surface-2)',
        borderRadius: '12px',
        padding: '3px',
      }}
    >
      {TABS.map((t, i) => (
        <button
          key={t}
          ref={(el) => { tabRefs.current[i] = el; }}
          role="tab"
          id={`tab-${t.toLowerCase()}`}
          aria-selected={active === t}
          aria-controls={`panel-${t.toLowerCase()}`}
          tabIndex={active === t ? 0 : -1}
          onClick={() => onChange(t)}
          onKeyDown={(e) => handleKeyDown(e, i)}
          style={{
            flex: 1,
            minHeight: 36,
            border: 0,
            borderRadius: '12px',
            background: active === t ? 'var(--surface)' : 'transparent',
            boxShadow: active === t ? '0 2px 8px rgba(18,20,23,0.08)' : 'none',
            color: active === t ? 'var(--ink)' : 'var(--muted)',
            fontFamily: "'Cabinet Grotesk', sans-serif",
            fontSize: '14px',
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

// ─── Main ExchangeMarket component ───────────────────────────────────────────

export default function ExchangeMarket({ marketId, market }) {
  const router = useRouter();
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [activeTab, setActiveTab] = useState('Book');
  // submittingRef tracks whether an order is in-flight so the poll is suppressed
  const submittingRef = useRef(false);

  // Pro view toggle — persisted to localStorage, off by default
  const [proMode, setProMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('betcha.proView') === '1';
    }
    return false;
  });

  const toggleProMode = () => {
    setProMode((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('betcha.proView', next ? '1' : '0');
      }
      return next;
    });
  };

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`/api/markets/${marketId}/exchange-state`);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        if (res.status === 401) {
          router.push('/');
          return;
        }
        setLoadError(payload.error || 'Failed to load exchange data.');
        return;
      }
      const data = await res.json();
      setState(data);
      setLoadError('');
    } catch {
      setLoadError('Connection error — retrying…');
    }
  }, [marketId, router]);

  // Initial fetch + interval polling
  useEffect(() => {
    if (!marketId) return;
    fetchState();
    const timer = setInterval(() => {
      if (shouldPoll(document.hidden, submittingRef.current)) {
        fetchState();
      }
    }, 2500);
    const onVisible = () => {
      if (!document.hidden) fetchState();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [marketId, fetchState]);

  const handleCancelOrder = async (orderId) => {
    try {
      const res = await fetch(`/api/markets/${marketId}/orders/${orderId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        fetchState();
      }
    } catch {
      // silent — user can retry
    }
  };

  const handleOrderSuccess = () => {
    fetchState();
  };

  // Build sparkline prices from recent trades (last 20 ticks) or just mark
  const sparkPrices =
    state?.trades?.map((t) => t.price).slice(-20) ??
    (state?.lastTrade != null ? [state.lastTrade] : []);

  const mark = state?.mark ?? null;
  const maxLeverage = market?.max_leverage ?? 10;

  return (
    <div>
      {/* ── Hero: title + mark price + sparkline ── */}
      <section
        className="market-detail-hero"
        style={{ marginBottom: '16px' }}
      >
        <div className="market-detail-header" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span
            className={`market-pill${market.state === 'open' ? ' live' : ''}`}
          >
            Exchange
            {market.state === 'open' ? ' · Live' : ''}
          </span>

          {/* Pro mode toggle */}
          <button
            type="button"
            role="switch"
            aria-checked={proMode}
            aria-label={proMode ? 'Pro view on — switch to standard view' : 'Pro view off — switch to pro view'}
            onClick={toggleProMode}
            onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleProMode(); } }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '3px 10px 3px 6px',
              borderRadius: '999px',
              border: '1px solid',
              borderColor: proMode ? 'var(--primary)' : 'var(--border)',
              background: proMode ? 'rgba(255,90,95,0.08)' : 'var(--surface)',
              color: proMode ? '#E84D4D' : 'var(--muted)',
              fontSize: '12px',
              fontFamily: "'Cabinet Grotesk', sans-serif",
              fontWeight: 700,
              cursor: 'pointer',
              letterSpacing: '0.04em',
              transition: 'border-color 150ms ease, color 150ms ease, background 150ms ease',
            }}
          >
            {/* Track + thumb */}
            <span
              aria-hidden="true"
              style={{
                display: 'inline-block',
                width: 28,
                height: 16,
                borderRadius: 9999,
                background: proMode ? '#FF5A5F' : 'var(--border)',
                position: 'relative',
                transition: 'background 150ms ease',
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 2,
                  left: proMode ? 13 : 2,
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: '#fff',
                  transition: 'left 150ms ease',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }}
              />
            </span>
            Pro
          </button>
        </div>
        <h1 className="market-detail-title">{market.title}</h1>

        {/* Mark price + sparkline row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: '20px',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "'Geist', sans-serif",
                fontVariantNumeric: 'tabular-nums',
                fontSize: 'clamp(40px, 8vw, 64px)',
                lineHeight: 1,
                letterSpacing: '-0.04em',
                fontWeight: 700,
                color: 'var(--ink)',
              }}
              aria-label={`Mark price: ${formatCents(mark)}`}
            >
              {formatCents(mark)}
            </div>
            <div
              style={{
                fontFamily: "'Cabinet Grotesk', sans-serif",
                fontSize: '14px',
                color: 'var(--muted)',
                marginTop: '4px',
              }}
            >
              {probabilityLabel(mark)}
            </div>
          </div>

          {/* Sparkline or last-trade label */}
          <div style={{ paddingBottom: '6px' }}>
            {sparkPrices.length >= 2 ? (
              <Sparkline prices={sparkPrices} />
            ) : state?.lastTrade != null ? (
              <span
                style={{
                  fontSize: '13px',
                  color: 'var(--muted)',
                  fontFamily: "'Geist', sans-serif",
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                Last trade: {formatCents(state.lastTrade)}
              </span>
            ) : null}
          </div>
        </div>

        {loadError && (
          <p
            style={{ margin: 0, fontSize: '13px', color: '#E84D4D' }}
            role="alert"
          >
            {loadError}
          </p>
        )}
      </section>

      {/* ── Pro view or calm Layout C body ── */}
      {proMode ? (
        <ProMarketView marketId={marketId} market={market} />
      ) : (
        <>
          {/* ── Two-column layout: ticket | panels ── */}
          <div
            className="exchange-layout"
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.2fr)',
              gap: '16px',
              alignItems: 'start',
            }}
          >
            {/* ─ Order Ticket ─ */}
            <section
              className="prediction-section"
              aria-label="Order ticket"
              style={{ padding: '20px' }}
            >
              <h2 className="section-title" style={{ marginBottom: '16px' }}>
                Place Order
              </h2>
              <OrderTicket
                marketId={marketId}
                maxLeverage={maxLeverage}
                onOrderSuccess={handleOrderSuccess}
                submittingRef={submittingRef}
              />
            </section>

            {/* ─ Tabs panel ─ */}
            <div style={{ display: 'grid', gap: '12px' }}>
              <Tabs active={activeTab} onChange={setActiveTab} />

              <section
                id={`panel-${activeTab.toLowerCase()}`}
                role="tabpanel"
                aria-labelledby={`tab-${activeTab.toLowerCase()}`}
                className="prediction-section"
                style={{ padding: '16px' }}
              >
                {activeTab === 'Book' && (
                  <OrderBook book={state?.book} />
                )}

                {activeTab === 'Position' && (
                  <PositionPanel myPosition={state?.myPosition} />
                )}

                {activeTab === 'Trades' && (
                  <div>
                    {state?.trades && state.trades.length > 0 ? (
                      <ul
                        style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '2px' }}
                        aria-label="Recent trades"
                      >
                        {[...state.trades].reverse().map((t, i) => (
                          <li
                            key={i}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '1fr 1fr',
                              gap: '4px',
                              padding: '6px 8px',
                              borderRadius: '6px',
                              background: 'var(--surface-2)',
                              fontFamily: "'Geist', sans-serif",
                              fontVariantNumeric: 'tabular-nums',
                              fontSize: '13px',
                            }}
                          >
                            <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{formatCents(t.price)}</span>
                            <span style={{ textAlign: 'right', color: 'var(--muted)' }}>{t.qty} shares</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p style={{ color: 'var(--muted)', fontSize: '14px', margin: '16px 0' }}>
                        No trades yet.
                      </p>
                    )}
                  </div>
                )}
              </section>

              {/* ─ Open Orders ─ */}
              {state?.myOpenOrders && state.myOpenOrders.length > 0 && (
                <section
                  className="prediction-section"
                  aria-label="Your open orders"
                  style={{ padding: '16px' }}
                >
                  <h3
                    className="section-title"
                    style={{ fontSize: '16px', marginBottom: '12px' }}
                  >
                    Your Open Orders
                  </h3>
                  <OpenOrders
                    orders={state.myOpenOrders}
                    onCancel={handleCancelOrder}
                  />
                </section>
              )}
            </div>
          </div>

          {/* ── Responsive: stack on mobile ── */}
          <style>{`
            @media (max-width: 680px) {
              .exchange-layout { grid-template-columns: 1fr !important; }
            }
          `}</style>
        </>
      )}
    </div>
  );
}
