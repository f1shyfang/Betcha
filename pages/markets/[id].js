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
  const [yesCount, setYesCount] = useState(0);
  const [noCount, setNoCount] = useState(0);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(true);

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

      // For simplicity, just refetch all from group and find it, or we could add a single GET /api/markets/:id
      const res = await fetch(`/api/markets`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      if (res.ok) {
        const data = await res.json();
        // Route params are strings in Next.js; normalize IDs before comparing.
        const found = data.find((m) => String(m.id) === String(id));
        setMarket(found);
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

      const predictions = await res.json();
      const yes = predictions.filter((p) => p.choice === true).length;
      const no = predictions.filter((p) => p.choice === false).length;
      setYesCount(yes);
      setNoCount(no);
      setLastUpdatedAt(new Date());
    } catch (err) {
      console.error(err);
    }
  };

  const placePrediction = async (choice) => {
    const { data: { session } } = await supabase.auth.getSession();
    const idempKey = `pred-${id}-${session.user.id}-${Date.now()}`;
    await fetch(`/api/markets/${id}/predictions`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        'idempotency-key': idempKey
      },
      body: JSON.stringify({ choice })
    });
    router.reload();
  };

  const handleResolve = async (outcome) => {
    try {
      await resolveMarket(id, outcome);
      router.reload();
    } catch (e) {
      alert(e.message);
    }
  };

  if (loading) return <div className="page">Loading...</div>;
  if (!market) return <div className="page">Market not found or unauthorized.</div>;

  const total = yesCount + noCount;
  const yesPct = total > 0 ? Math.round((yesCount / total) * 100) : 50;
  const noPct = 100 - yesPct;

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
          </div>
        </section>

        {market.state === 'open' && (
          <section className="prediction-section" style={{ marginTop: '24px' }}>
            <h2 className="section-title">Place Your Prediction</h2>
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

        {market.state === 'open' && (
          <section className="resolve-section" style={{ marginTop: '24px' }}>
            <h2 className="section-title" style={{ fontSize: '16px', color: 'var(--muted)' }}>Creator Actions: Resolve Market</h2>
            <div className="prediction-buttons">
              <button className="button button-secondary" onClick={() => handleResolve(true)}>Resolve YES</button>
              <button className="button button-secondary" onClick={() => handleResolve(false)}>Resolve NO</button>
            </div>
          </section>
        )}

        {market.state === 'resolved' && market.resolution && (
          <section style={{ marginTop: '24px' }}>
            <div className="resolution-banner">
              <div className="resolution-outcome">
                Outcome: {market.resolution.outcome ? 'YES' : 'NO'}
              </div>
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
    </div>
  );
}
