import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import supabase from '../../lib/supabase';
import Head from 'next/head';
import Link from 'next/link';

export default function MarketsIndex() {
  const router = useRouter();
  const [markets, setMarkets] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newMarketTitle, setNewMarketTitle] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  useEffect(() => {
    fetchMarkets();
    fetchGroups();
  }, []);

  const fetchMarkets = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push('/');

      const res = await fetch('/api/markets', {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setMarkets(data);
      }
      setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  const fetchGroups = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch('/api/groups', {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setGroups(data);
        if (!selectedGroupId && data.length > 0) {
          setSelectedGroupId(data[0].id);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const createMarket = async (e) => {
    e.preventDefault();
    if (!newMarketTitle.trim() || !selectedGroupId) return;

    setCreating(true);
    setCreateError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }

      const res = await fetch('/api/markets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          title: newMarketTitle.trim(),
          group_id: selectedGroupId
        })
      });

      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error || 'Failed to create market');
        return;
      }

      setNewMarketTitle('');
      await fetchMarkets();
      if (data.id) {
        router.push(`/markets/${data.id}`);
      }
    } catch (err) {
      console.error(err);
      setCreateError('Failed to create market');
    } finally {
      setCreating(false);
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
          <div className="skeleton-shimmer" style={{ height: '32px', width: '160px', borderRadius: '8px', marginBottom: '24px' }} />
          <div className="markets-grid">
            {[1, 2, 3].map((n) => (
              <div key={n} className="skeleton-shimmer" style={{ height: '120px', borderRadius: '12px' }} />
            ))}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="page">
      <Head><title>All Markets - Betcha</title></Head>
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">B</span>
          <div className="brand-name">Betcha</div>
        </div>
      </header>

      <main>
        <div className="dashboard-header" style={{ marginBottom: '24px' }}>
          <div className="dashboard-title-area">
            <h1 className="dashboard-title">All Markets</h1>
          </div>
        </div>

        <form className="create-form" onSubmit={createMarket} style={{ marginBottom: '32px' }}>
          <div className="dashboard-header">
            <h2 className="dashboard-title" style={{ fontSize: '20px' }}>Create New Market</h2>
          </div>
          {groups.length === 0 ? (
            <div className="empty-state" style={{ padding: '12px 0', textAlign: 'left' }}>
              <p>
                You need a group before creating markets.{' '}
                <Link href="/groups">Create or join a group</Link>.
              </p>
            </div>
          ) : (
            <>
              <div className="form-row">
                <label className="label">
                  Market Question
                  <input
                    type="text"
                    value={newMarketTitle}
                    onChange={(e) => setNewMarketTitle(e.target.value)}
                    placeholder="Will we finish the sprint by Friday?"
                    required
                  />
                </label>
              </div>
              <div className="form-row">
                <label className="label">
                  Group
                  <select
                    value={selectedGroupId}
                    onChange={(e) => setSelectedGroupId(e.target.value)}
                    required
                  >
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button type="submit" className="button" disabled={creating}>
                {creating ? 'Creating...' : 'Create Market'}
              </button>
              {createError && (
                <div className="message error" role="alert">{createError}</div>
              )}
            </>
          )}
        </form>

        <section>
          {markets.length === 0 ? (
            <div className="empty-state">
              <h3>No markets</h3>
              <p>You aren't part of any active markets.</p>
            </div>
          ) : (
            <div className="markets-grid">
              {markets.map(m => (
                <article key={m.id} className={`market-card ${m.state === 'resolved' ? 'dark' : ''}`} role="link" onClick={() => router.push(`/markets/${m.id}`)}>
                  <div className="market-head">
                    <span className={`market-pill ${m.state === 'open' ? 'live' : ''}`}>{m.state}</span>
                  </div>
                  <h3>{m.title}</h3>
                  <div className="market-footer">
                    <span>{m.prediction_count || 0} predictions</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
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
