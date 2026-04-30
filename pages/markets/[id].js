import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import supabase from '../../lib/supabase';
import Head from 'next/head';
import Link from 'next/link';
import { resolveMarket } from '../../lib/api';

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

  useEffect(() => {
    if (!id) return;
    fetchMarket();
    fetchPredictionStats();
    const timer = setInterval(fetchPredictionStats, 5000);
    return () => clearInterval(timer);
  }, [id]);

  const fetchMarket = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push('/');
      setCurrentUserId(session.user.id);

      const res = await fetch(`/api/markets/${id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !id) return;

      const res = await fetch(`/api/markets/${id}/predictions`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      if (!res.ok) return;

      const preds = await res.json();
      const yes = preds.filter((p) => p.choice === true).length;
      const no = preds.filter((p) => p.choice === false).length;
      setYesCount(yes);
      setNoCount(no);
      setPredictions(preds);
      setLastUpdatedAt(new Date());
      const mine = preds.find((p) => p.user_id === session.user.id);
      setMyPrediction(mine !== undefined ? mine.choice : null);
    } catch (err) {
      console.error(err);
    }
  };

  const placePrediction = async (choice) => {
    const { data: { session } } = await supabase.auth.getSession();
    const idempKey = `pred-${id}-${session.user.id}-${Date.now()}`;
    const res = await fetch(`/api/markets/${id}/predictions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        'idempotency-key': idempKey
      },
      body: JSON.stringify({ choice, stake_points: stakePoints })
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      alert(payload.error || 'Failed to place prediction');
      return;
    }
    router.reload();
  };

  const uploadEvidenceImage = async (file) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      alert('Please sign in again.');
      return;
    }
    setUploadingImage(true);
    try {
      const uploadMeta = await fetch('/api/support/upload-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
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
    } finally {
      setUploadingImage(false);
    }
  };

  const askSupportChatbot = async () => {
    if (!supportInput.trim()) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      alert('Please sign in again.');
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
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          message: userMessage,
          marketTitle: market?.title,
          outcome: true,
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
      alert(e.message || 'Support chatbot failed');
    } finally {
      setSupportLoading(false);
    }
  };

  const handleResolve = async (outcome) => {
    setResolving(true);
    try {
      await resolveMarket(id, outcome, 'creator', resolveReason, evidenceImageUrl);
      router.reload();
    } catch (e) {
      alert(e.message);
    } finally {
      setResolving(false);
    }
  };

  const handleShare = async () => {
    const outcome = market.resolution.outcome;
    const text = `Outcome: ${outcome ? 'YES' : 'NO'} — ${market.title}`;
    try {
      await navigator.share({ title: market.title, text });
    } catch (err) {
      if (err.name !== 'AbortError') {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    }
  };

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
            <span className={`market-pill ${market.state === 'open' ? 'live' : ''}`}>{market.state}</span>
          </div>
          <h1 className="market-detail-title">{market.title}</h1>

          <div className="odds-display" aria-live="polite">
            <div className="odds-bar">
              <div className="odds-fill odds-fill-yes" style={{ width: `${yesPct}%` }} />
              <div className="odds-fill odds-fill-no" style={{ width: `${noPct}%` }} />
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
            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
              Last updated:{' '}
              {lastUpdatedAt
                ? lastUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : '...'}
            </div>
            {myPrediction !== null && (
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                borderRadius: '999px',
                fontSize: '13px',
                fontWeight: 600,
                background: myPrediction ? 'rgba(0,194,168,0.12)' : 'rgba(255,90,95,0.12)',
                color: myPrediction ? '#0d6b60' : '#8c2727',
                border: `1px solid ${myPrediction ? 'rgba(0,194,168,0.25)' : 'rgba(255,90,95,0.25)'}`,
                width: 'fit-content',
              }}>
                Your prediction: {myPrediction ? 'YES ✓' : 'NO ✓'} {myStake > 0 ? `· Stake ${myStake}` : ''}
              </div>
            )}
            <div style={{ fontSize: '13px', color: 'var(--muted)' }}>
              Balance: {myBalance} points
            </div>
          </div>
        </section>

        {market.state === 'open' && myPrediction === null && (
          <section className="prediction-section" style={{ marginTop: '24px' }}>
            <h2 className="section-title">Place Your Prediction</h2>
            <label className="label" style={{ marginBottom: '10px' }}>
              Stake points
              <input
                type="number"
                min="1"
                max={Math.max(1, myBalance)}
                step="1"
                value={stakePoints}
                onChange={(e) => setStakePoints(Number(e.target.value || 0))}
              />
            </label>
            <div className="prediction-buttons">
              <button className="button button-predict button-predict-yes" onClick={() => placePrediction(true)}>
                YES
              </button>
              <button className="button button-predict button-predict-no" onClick={() => placePrediction(false)}>
                NO
              </button>
            </div>
          </section>
        )}

        {market.state === 'open' && (!market.creator_id || market.creator_id === currentUserId) && (
          <section className="resolve-section" style={{ marginTop: '24px' }}>
            <h2 className="section-title" style={{ fontSize: '16px', color: 'var(--muted)' }}>Resolve Market</h2>
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
            {evidenceImageUrl && (
              <p className="prediction-confirmation">
                Evidence uploaded: <a href={evidenceImageUrl} target="_blank" rel="noreferrer">view image</a>
              </p>
            )}
            <div className="prediction-buttons">
              <button className="button button-secondary" disabled={resolving} onClick={() => handleResolve(true)}>Resolve YES</button>
              <button className="button button-secondary" disabled={resolving} onClick={() => handleResolve(false)}>Resolve NO</button>
            </div>
          </section>
        )}

        {isResolved && (
          <section style={{ marginTop: '24px' }}>
            <div className="resolution-banner">
              <div style={{ fontSize: '28px', fontWeight: 700, fontFamily: "'Cabinet Grotesk', sans-serif", marginBottom: '12px' }}>
                OUTCOME: {outcomeValue ? 'YES' : 'NO'}
              </div>

              {myCorrect !== null && (
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 14px',
                  borderRadius: '999px',
                  fontSize: '15px',
                  fontWeight: 700,
                  background: myCorrect ? 'rgba(0,194,168,0.15)' : 'rgba(255,90,95,0.15)',
                  color: myCorrect ? '#0d6b60' : '#8c2727',
                  border: `1px solid ${myCorrect ? 'rgba(0,194,168,0.3)' : 'rgba(255,90,95,0.3)'}`,
                  marginBottom: '16px',
                }}>
                  {settlement.total_delta > 0 ? '+' : ''}{settlement.total_delta} points
                </div>
              )}

              {settlementEntries.length > 0 && (
                <div style={{ marginBottom: '16px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {settlementEntries.map(([reason, delta]) => (
                    <span key={reason} style={{
                      padding: '4px 10px',
                      borderRadius: '999px',
                      background: 'rgba(18,20,23,0.06)',
                      color: 'var(--text)',
                      fontSize: '12px',
                      fontWeight: 600,
                    }}>
                      {reason.replace('_', ' ')}: {delta > 0 ? '+' : ''}{delta}
                    </span>
                  ))}
                </div>
              )}

              {visibleWinners.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Winners
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {visibleWinners.map((p) => (
                      <span key={p.user_id} style={{
                        padding: '4px 10px',
                        borderRadius: '999px',
                        background: 'rgba(0,194,168,0.1)',
                        color: '#0d6b60',
                        fontSize: '13px',
                        fontWeight: 600,
                        border: '1px solid rgba(0,194,168,0.2)',
                      }}>
                        {p.display_name || p.user_id}
                      </span>
                    ))}
                    {extraWinners > 0 && (
                      <Link href={`/groups/${market.group_id}`} style={{
                        padding: '4px 10px',
                        borderRadius: '999px',
                        background: 'rgba(18,20,23,0.06)',
                        color: 'var(--muted)',
                        fontSize: '13px',
                        fontWeight: 600,
                        textDecoration: 'none',
                      }}>
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
