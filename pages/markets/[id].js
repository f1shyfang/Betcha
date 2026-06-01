import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { authClient } from '../../lib/authClient';
import Head from 'next/head';
import Link from 'next/link';
import { resolveMarket } from '../../lib/api';
import { predictionErrorMessage, stablePredictionKey, applyOptimisticPrediction, shouldPoll, resolveSummary, clampStake, stakePresets, stakeValidationMessage, shareText, inviteText } from '../../lib/predictionForm';

export default function MarketDetail() {
  const router = useRouter();
  const { id } = router.query;
  const [market, setMarket] = useState(null);
  const [predictions, setPredictions] = useState([]);
  const [yesCount, setYesCount] = useState(0);
  const [noCount, setNoCount] = useState(0);
  const [myPrediction, setMyPrediction] = useState(null); // true | false | null
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [copied, setCopied] = useState(false);
  const [stakePoints, setStakePoints] = useState(100);
  const [resolveReason, setResolveReason] = useState('');
  const [supportChatOpen, setSupportChatOpen] = useState(false);
  const [supportInput, setSupportInput] = useState('');
  const [supportMessages, setSupportMessages] = useState([]);
  const [supportLoading, setSupportLoading] = useState(false);
  const [evidenceImageUrl, setEvidenceImageUrl] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false); // resolve form disclosure
  const [pendingResolve, setPendingResolve] = useState(null); // true | false | null — awaiting confirm
  const [pendingChoice, setPendingChoice] = useState(null); // true | false | null — awaiting confirm
  const pendingChoiceRef = useRef(null); // mirror of pendingChoice for the polling interval
  const [placing, setPlacing] = useState(false);
  const [predictError, setPredictError] = useState('');
  const [resolveError, setResolveError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [supportError, setSupportError] = useState('');

  useEffect(() => {
    pendingChoiceRef.current = pendingChoice;
  }, [pendingChoice]);

  // Keep the stake within the user's balance once it loads (default may exceed it).
  useEffect(() => {
    if (market?.my_balance != null) {
      setStakePoints((s) => clampStake(s, market.my_balance));
    }
  }, [market?.my_balance]);

  useEffect(() => {
    if (!id) return;
    fetchMarket();
    fetchPredictionStats();
    // Poll only when the tab is visible and the user isn't mid-decision, so we
    // don't burn requests in background tabs or reflow the odds bar under them.
    const timer = setInterval(() => {
      if (shouldPoll(document.hidden, pendingChoiceRef.current !== null)) {
        fetchPredictionStats();
      }
    }, 5000);
    // Refresh immediately when the tab regains focus (it may be stale).
    const onVisible = () => {
      if (!document.hidden) fetchPredictionStats();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [id]);

  const fetchMarket = async () => {
    try {
      const { data: sess } = await authClient.getSession();
      if (!sess?.session) return router.push('/');
      setCurrentUserId(sess.user.id);

      const res = await fetch(`/api/markets/${id}`);
      if (res.ok) {
        const data = await res.json();
        setMarket(data.market || null);
      }
      setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  const fetchPredictionStats = async () => {
    try {
      const { data: sess } = await authClient.getSession();
      if (!sess?.session || !id) return;

      const res = await fetch(`/api/markets/${id}/predictions`);
      if (!res.ok) return;

      const preds = await res.json();
      const yes = preds.filter((p) => p.choice === true).length;
      const no = preds.filter((p) => p.choice === false).length;
      setYesCount(yes);
      setNoCount(no);
      setPredictions(preds);
      setLastUpdatedAt(new Date());
      const mine = preds.find((p) => p.user_id === sess.user.id);
      setMyPrediction(mine !== undefined ? mine.choice : null);
    } catch (err) {
      console.error(err);
    }
  };

  // Tapping YES/NO arms a confirmation rather than committing points immediately.
  const requestPrediction = (choice) => {
    setPredictError('');
    setPendingChoice(choice);
  };

  const confirmPrediction = async () => {
    if (pendingChoice === null) return;
    const choice = pendingChoice;
    setPredictError('');
    setPlacing(true);
    try {
      const { data: sess } = await authClient.getSession();
      if (!sess?.session) {
        setPredictError('Your session expired. Please sign in again.');
        return;
      }
      const res = await fetch(`/api/markets/${id}/predictions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Stable key so a rapid double-tap collapses to one prediction.
          'idempotency-key': stablePredictionKey(id, sess.user.id, choice, stakePoints),
        },
        body: JSON.stringify({ choice, stake_points: stakePoints }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setPredictError(predictionErrorMessage(res.status, payload));
        return;
      }
      // Reflect the prediction instantly, then reconcile with the server — no
      // full page reload (which re-ran the skeleton and lost scroll/focus).
      const next = applyOptimisticPrediction(
        { yesCount, noCount, myBalance: market?.my_balance ?? 0 },
        choice,
        stakePoints
      );
      setYesCount(next.yesCount);
      setNoCount(next.noCount);
      setMyPrediction(next.myPrediction);
      setMarket((prev) =>
        prev
          ? {
              ...prev,
              my_prediction: { choice: next.myPrediction, stake_points: next.myStake },
              my_balance: next.myBalance,
            }
          : prev
      );
      setPendingChoice(null);
      fetchMarket();
      fetchPredictionStats();
    } catch (e) {
      setPredictError("Couldn't place your prediction. Try again.");
    } finally {
      setPlacing(false);
    }
  };

  const uploadEvidenceImage = async (file) => {
    setUploadError('');
    const { data: sess } = await authClient.getSession();
    if (!sess?.session) {
      setUploadError('Your session expired. Please sign in again.');
      return;
    }
    setUploadingImage(true);
    try {
      const uploadMeta = await fetch('/api/support/upload-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
        }),
      });
      if (!uploadMeta.ok) {
        const payload = await uploadMeta.json().catch(() => ({}));
        throw new Error(payload.error || 'Failed to prepare upload');
      }
      const { uploadUrl, fileUrl } = await uploadMeta.json();

      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type,
        },
        body: file,
      });
      if (!uploadRes.ok) {
        throw new Error('Failed to upload image');
      }

      setEvidenceImageUrl(fileUrl);
    } catch (e) {
      console.error('Evidence image upload failed', e);
      setUploadError(e.message || "Couldn't upload that image. Try again.");
    } finally {
      setUploadingImage(false);
    }
  };

  const askSupportChatbot = async () => {
    if (!supportInput.trim()) return;
    setSupportError('');
    const { data: sess } = await authClient.getSession();
    if (!sess?.session) {
      setSupportError('Your session expired. Please sign in again.');
      return;
    }
    // The note is written for a specific outcome, so the creator must pick a
    // side first — otherwise the suggestion would argue for the wrong result.
    if (pendingResolve === null) {
      setSupportError('Pick Resolve YES or NO first, then I can help write the note.');
      return;
    }
    const userMessage = supportInput.trim();
    setSupportMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setSupportInput('');
    setSupportLoading(true);
    try {
      const res = await fetch('/api/support/chatbot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage,
          marketTitle: market?.title,
          outcome: pendingResolve,
          evidenceImageUrl,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error || 'Failed to get support reply');
      }
      const reply = payload.reply || '';
      setSupportMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
      if (reply) {
        setResolveReason((prev) => (prev ? `${prev}\n${reply}` : reply));
      }
    } catch (e) {
      setSupportError(e.message || "Support chat didn't respond. Try again.");
    } finally {
      setSupportLoading(false);
    }
  };

  const handleResolve = async (outcome) => {
    setResolveError('');
    setResolving(true);
    try {
      await resolveMarket(id, outcome, 'creator', resolveReason, evidenceImageUrl);
      // Reconcile in place instead of a hard reload.
      await Promise.all([fetchMarket(), fetchPredictionStats()]);
      setPendingResolve(null);
      setResolveOpen(false);
    } catch (e) {
      setResolveError(e.message || "Couldn't resolve the market. Try again.");
    } finally {
      setResolving(false);
    }
  };

  // Web Share where supported (mostly mobile); fall back to clipboard on desktop.
  const shareOrCopy = async (text) => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: market.title, text });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return; // user dismissed the sheet
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      // Clipboard unavailable (e.g. insecure context) — nothing more we can do.
    }
  };

  const handleShare = () => shareOrCopy(shareText(market.title, market.resolution.outcome));
  const handleInvite = () =>
    shareOrCopy(inviteText(market.title, typeof window !== 'undefined' ? window.location.href : ''));

  if (loading) {
    return (
      <div className="page">
        <header className="topbar">
          <div className="brand-lockup">
            <span className="brand-mark">B</span>
            <div className="brand-name">Betcha</div>
          </div>
        </header>
        <main>
          <div className="skeleton-shimmer" style={{ height: '20px', width: '120px', borderRadius: '6px', marginBottom: '16px' }} />
          <div className="skeleton-shimmer" style={{ height: '40px', width: '80%', borderRadius: '8px', marginBottom: '24px' }} />
          <div className="skeleton-shimmer" style={{ height: '80px', borderRadius: '12px', marginBottom: '24px' }} />
          <div style={{ display: 'flex', gap: '12px' }}>
            <div className="skeleton-shimmer" style={{ height: '56px', flex: 1, borderRadius: '12px' }} />
            <div className="skeleton-shimmer" style={{ height: '56px', flex: 1, borderRadius: '12px' }} />
          </div>
        </main>
      </div>
    );
  }
  if (!market) return <div className="page">Market not found or unauthorized.</div>;

  const total = yesCount + noCount;
  const yesPct = total > 0 ? Math.round((yesCount / total) * 100) : 50;
  const noPct = 100 - yesPct;

  const isResolved = market.state === 'resolved' && market.resolution;
  const outcomeValue = isResolved ? market.resolution.outcome : null;
  const winners = isResolved
    ? predictions.filter((p) => p.choice === outcomeValue)
    : [];
  const visibleWinners = winners.slice(0, 10);
  const extraWinners = winners.length - visibleWinners.length;
  const myCorrect = isResolved && myPrediction !== null ? myPrediction === outcomeValue : null;
  const settlement = market.my_settlement || { total_delta: 0, breakdown: {} };
  const settlementEntries = Object.entries(settlement.breakdown || {});
  const myBalance = market.my_balance ?? 0;
  const myStake = market.my_prediction?.stake_points ?? 0;
  const stakeError = stakeValidationMessage(stakePoints, myBalance);
  const presets = stakePresets(myBalance);

  return (
    <div className="page">
      <Head><title>{market.title} - Betcha</title></Head>
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">B</span>
          <div className="brand-name">Betcha</div>
        </div>
      </header>

      <main>
        <button className="button button-ghost" onClick={() => router.push(`/groups/${market.group_id}`)} style={{ marginBottom: '16px', padding: 0 }}>
          ← Back to Group
        </button>

        <section className="market-detail-hero">
          <div className="market-detail-header">
            <span className={`market-pill ${market.state === 'open' ? 'live' : ''}`}>
              {market.state === 'open' ? 'Open' : market.state === 'resolved' ? 'Resolved' : market.state}
            </span>
            {market.state === 'open' && (
              <button
                type="button"
                className="button button-ghost button-sm"
                style={{ marginLeft: 'auto' }}
                onClick={handleInvite}
              >
                {copied ? 'Link copied!' : 'Share market'}
              </button>
            )}
          </div>
          <h1 className="market-detail-title">{market.title}</h1>

          <div className="odds-display" aria-live="polite">
            {total === 0 ? (
              <div className="odds-empty">
                <strong>No predictions yet</strong>
                <span>{market.state === 'open' ? 'Be the first to take a side.' : 'Nobody weighed in on this one.'}</span>
              </div>
            ) : (
              <>
                <div className="odds-bar">
                  <div className="odds-fill odds-fill-yes" style={{ transform: `scaleX(${yesPct / 100})` }} />
                </div>
                <div className="odds-labels">
                  <div className="odds-label odds-yes">
                    <strong>{yesPct}%</strong>
                    <span>YES ({yesCount})</span>
                  </div>
                  <div className="odds-label odds-no" style={{ textAlign: 'right' }}>
                    <strong>{noPct}%</strong>
                    <span>NO ({noCount})</span>
                  </div>
                </div>
              </>
            )}
            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
              Last updated:{' '}
              {lastUpdatedAt
                ? lastUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : '...'}
            </div>
            {myPrediction !== null && (
              <div className={`choice-pill ${myPrediction ? 'choice-yes' : 'choice-no'}`}>
                Your prediction: {myPrediction ? 'YES ✓' : 'NO ✓'}{myStake > 0 ? ` · Stake ${myStake}` : ''}
              </div>
            )}
            <div style={{ fontSize: '13px', color: 'var(--muted)' }}>
              Balance: {myBalance} points
            </div>
          </div>
        </section>

        {market.state === 'open' && (
          <section className="prediction-section" style={{ marginTop: '24px' }}>
            <h2 className="section-title">{myPrediction === null ? 'Place Your Prediction' : 'Your Prediction'}</h2>
            {myPrediction === null && (
              <div style={{ marginBottom: '10px' }}>
                <label className="label">
                  Stake points
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max={Math.max(1, myBalance)}
                    step="1"
                    value={stakePoints}
                    onChange={(e) => setStakePoints(clampStake(e.target.value, myBalance))}
                    aria-invalid={!!stakeError}
                    aria-describedby={stakeError ? 'stake-error' : undefined}
                  />
                </label>
                {presets.length > 0 && (
                  <div className="stake-presets" role="group" aria-label="Quick stake amounts">
                    {presets.map((p) => (
                      <button
                        type="button"
                        key={p.label}
                        className={`stake-preset${stakePoints === p.value ? ' is-selected' : ''}`}
                        aria-pressed={stakePoints === p.value}
                        onClick={() => setStakePoints(clampStake(p.value, myBalance))}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                )}
                {stakeError && (
                  <div id="stake-error" className="message error" role="alert">{stakeError}</div>
                )}
              </div>
            )}
            <div className="prediction-buttons">
              <button
                type="button"
                className={`button button-predict button-predict-yes${(myPrediction === true || pendingChoice === true) ? ' button-predict-active' : ''}`}
                aria-pressed={myPrediction === true}
                disabled={myPrediction !== null || placing || !!stakeError}
                onClick={() => requestPrediction(true)}
              >
                <span aria-hidden="true">✓</span> YES
              </button>
              <button
                type="button"
                className={`button button-predict button-predict-no${(myPrediction === false || pendingChoice === false) ? ' button-predict-active' : ''}`}
                aria-pressed={myPrediction === false}
                disabled={myPrediction !== null || placing || !!stakeError}
                onClick={() => requestPrediction(false)}
              >
                <span aria-hidden="true">✗</span> NO
              </button>
            </div>

            {myPrediction === null && pendingChoice !== null && (
              <div className="prediction-confirm" role="group" aria-label="Confirm your prediction">
                <span>
                  Stake <strong>{stakePoints}</strong> on <strong>{pendingChoice ? 'YES' : 'NO'}</strong>?
                </span>
                <div className="prediction-confirm-actions">
                  <button type="button" className="button button-secondary button-sm" disabled={placing} onClick={confirmPrediction}>
                    {placing ? 'Placing…' : 'Confirm'}
                  </button>
                  <button type="button" className="button button-ghost button-sm" disabled={placing} onClick={() => setPendingChoice(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {predictError && (
              <div className="message error" role="alert">
                {predictError}{' '}
                {pendingChoice !== null && !placing && (
                  <button type="button" className="button button-ghost button-sm" onClick={confirmPrediction}>Retry</button>
                )}
              </div>
            )}
          </section>
        )}

        {market.state === 'open' && (!market.creator_id || market.creator_id === currentUserId) && (
          <section className="resolve-section" style={{ marginTop: '24px' }}>
            <button
              type="button"
              className="resolve-disclosure"
              aria-expanded={resolveOpen}
              onClick={() => setResolveOpen((open) => !open)}
            >
              <span>Resolve this market</span>
              <span aria-hidden="true">{resolveOpen ? '–' : '+'}</span>
            </button>

            {resolveOpen && (
              <div className="resolve-body">
                <label className="label">
                  Resolution reason
                  <input
                    type="text"
                    value={resolveReason}
                    onChange={(e) => setResolveReason(e.target.value)}
                    placeholder="Why this outcome is correct"
                  />
                </label>
                <label className="label">
                  Evidence image
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files && e.target.files[0];
                      if (file) uploadEvidenceImage(file);
                    }}
                  />
                </label>
                {uploadingImage && <p className="prediction-confirmation">Uploading image...</p>}
                {uploadError && <div className="message error" role="alert">{uploadError}</div>}
                {evidenceImageUrl && (
                  <p className="prediction-confirmation">
                    Evidence uploaded: <a href={evidenceImageUrl} target="_blank" rel="noreferrer">view image</a>
                  </p>
                )}

                {pendingResolve === null ? (
                  <div className="prediction-buttons">
                    <button type="button" className="button button-secondary" disabled={resolving} onClick={() => setPendingResolve(true)}>Resolve YES</button>
                    <button type="button" className="button button-secondary" disabled={resolving} onClick={() => setPendingResolve(false)}>Resolve NO</button>
                  </div>
                ) : (
                  <div className="prediction-confirm" role="group" aria-label="Confirm resolution">
                    <span>{resolveSummary(total, pendingResolve)}</span>
                    <div className="prediction-confirm-actions">
                      <button type="button" className="button button-secondary button-sm" disabled={resolving} onClick={() => handleResolve(pendingResolve)}>
                        {resolving ? 'Resolving…' : 'Confirm'}
                      </button>
                      <button type="button" className="button button-ghost button-sm" disabled={resolving} onClick={() => setPendingResolve(null)}>Cancel</button>
                    </div>
                  </div>
                )}
                {resolveError && <div className="message error" role="alert">{resolveError}</div>}
              </div>
            )}
          </section>
        )}

        {isResolved && (
          <section style={{ marginTop: '24px' }}>
            <div className="resolution-banner">
              <div className="resolution-headline">
                OUTCOME: {outcomeValue ? 'YES' : 'NO'}
              </div>

              {myCorrect !== null && (
                <div className={`choice-pill ${myCorrect ? 'choice-yes' : 'choice-no'}`} style={{ marginBottom: '16px' }}>
                  {settlement.total_delta > 0 ? '+' : ''}{settlement.total_delta} points
                </div>
              )}

              {settlementEntries.length > 0 && (
                <div className="chip-row">
                  {settlementEntries.map(([reason, delta]) => (
                    <span key={reason} className="chip">
                      {reason.replaceAll('_', ' ')}: {delta > 0 ? '+' : ''}{delta}
                    </span>
                  ))}
                </div>
              )}

              {visibleWinners.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <div className="chip-group-label">Winners</div>
                  <div className="chip-row" style={{ marginBottom: 0 }}>
                    {visibleWinners.map((p) => (
                      <span key={p.user_id} className="choice-pill choice-yes">
                        {p.display_name || p.user_id}
                      </span>
                    ))}
                    {extraWinners > 0 && (
                      <Link href={`/groups/${market.group_id}`} className="chip chip-link">
                        and {extraWinners} more →
                      </Link>
                    )}
                  </div>
                </div>
              )}

              <button
                className="button button-secondary"
                onClick={handleShare}
                style={{ marginTop: '4px' }}
              >
                {copied ? 'Copied!' : 'Share Result'}
              </button>
            </div>
          </section>
        )}
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">
        <Link href="/" className="bottom-nav-item">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span>Home</span>
        </Link>
        <Link href="/groups" className="bottom-nav-item">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <span>Groups</span>
        </Link>
        <Link href="/markets" className="bottom-nav-item bottom-nav-active">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>
          <span>Markets</span>
        </Link>
      </nav>

      <button
        className="support-chat-fab"
        type="button"
        onClick={() => setSupportChatOpen((open) => !open)}
        aria-label="Open support chat"
      >
        💬
      </button>

      {supportChatOpen && (
        <section className="support-chat-panel" aria-label="Support chat">
          <div className="support-chat-header">
            <strong>Support chatbot</strong>
            <button className="button button-ghost button-sm" onClick={() => setSupportChatOpen(false)}>Close</button>
          </div>
          <div className="support-chat-messages">
            {supportMessages.length === 0 ? (
              <p className="prediction-confirmation">Ask for help writing the resolve reason.</p>
            ) : supportMessages.map((msg, idx) => (
              <div key={`${msg.role}-${idx}`} className={`support-chat-bubble ${msg.role === 'user' ? 'user' : 'assistant'}`}>
                {msg.content}
              </div>
            ))}
          </div>
          {supportError && <div className="message error" role="alert" style={{ margin: '0 16px' }}>{supportError}</div>}
          <div className="support-chat-compose">
            <input
              type="text"
              value={supportInput}
              onChange={(e) => setSupportInput(e.target.value)}
              placeholder="Ask support for a resolution note..."
            />
            <button
              className="button button-secondary button-sm"
              onClick={askSupportChatbot}
              disabled={supportLoading || !supportInput.trim()}
            >
              Send
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
