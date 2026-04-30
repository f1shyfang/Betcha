import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import supabase from '../../lib/supabase';
import Head from 'next/head';
import Link from 'next/link';
import { createMarket as createMarketApi } from '../../lib/api';

export default function GroupDetail() {
  const router = useRouter();
  const { id } = router.query;
  const [group, setGroup] = useState(null);
  const [markets, setMarkets] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteToken, setInviteToken] = useState(null);
  const [newMarketTitle, setNewMarketTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (id) {
      fetchGroup();
      fetchLeaderboard();
    }
  }, [id]);

  const fetchGroup = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push('/');

      const groupsRes = await fetch('/api/groups', {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      if (groupsRes.ok) {
        const groupsData = await groupsRes.json();
        const currentGroup = groupsData.find((g) => String(g.id) === String(id));
        setGroup(currentGroup || null);
      }

      const res = await fetch(`/api/markets?group_id=${id}`, {
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

  const fetchLeaderboard = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`/api/groups/${id}/leaderboard`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setLeaderboard(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const createInvite = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/groups/${id}/invites`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    if (res.ok) {
      const data = await res.json();
      setInviteToken(data.token);
    }
  };

  const createMarket = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createMarketApi({ title: newMarketTitle, groupId: id });
      setNewMarketTitle('');
      fetchGroup();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const copyInviteLink = () => {
    if (!inviteToken) return;
    const url = `${window.location.origin}/join?token=${inviteToken}`;
    navigator.clipboard.writeText(url).catch(() => {});
  };

  if (loading) {
    return (
      <div className="page">
        <header className="topbar">
          <div className="brand-lockup">
            <span className="brand-mark">B</span>
            <div>
              <div className="brand-name">Betcha</div>
            </div>
          </div>
        </header>
        <main>
          <div className="skeleton-shimmer" style={{ height: '32px', width: '200px', borderRadius: '8px', marginBottom: '24px' }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px', marginBottom: '32px' }}>
            {[1, 2, 3].map((n) => (
              <div key={n} className="skeleton-shimmer" style={{ height: '120px', borderRadius: '12px' }} />
            ))}
          </div>
          <div className="skeleton-shimmer" style={{ height: '24px', width: '160px', borderRadius: '8px', marginBottom: '12px' }} />
          {[1, 2].map((n) => (
            <div key={n} className="skeleton-shimmer" style={{ height: '44px', borderRadius: '8px', marginBottom: '8px' }} />
          ))}
        </main>
      </div>
    );
  }

  return (
    <div className="page">
      <Head><title>{group?.name || 'Group'} - Betcha</title></Head>
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">B</span>
          <div>
            <div className="brand-name">Betcha</div>
            <Link href="/groups" className="brand-tag" style={{ textDecoration: 'none' }}>← My Groups</Link>
          </div>
        </div>
        <div className="dashboard-actions">
          <button className="button button-secondary button-sm" onClick={createInvite}>
            Generate Invite Link
          </button>
        </div>
      </header>

      <main>
        <div className="dashboard-header" style={{ marginBottom: '24px' }}>
          <div className="dashboard-title-area">
            <h1 className="dashboard-title">{group?.name || 'Group Dashboard'}</h1>
          </div>
        </div>

        {inviteToken && (
          <div className="invite-banner" style={{ marginBottom: '24px' }}>
            <span className="invite-label">Invite Link</span>
            <span className="invite-link">{window.location.origin}/join?token={inviteToken}</span>
            <button className="button button-secondary button-sm" onClick={copyInviteLink} style={{ whiteSpace: 'nowrap' }}>
              Copy Link
            </button>
          </div>
        )}

        <section style={{ marginBottom: '32px' }}>
          <div className="dashboard-header" style={{ marginBottom: '16px' }}>
            <h2 className="dashboard-title" style={{ fontSize: '24px' }}>Live Markets</h2>
            <button className="button button-sm" onClick={() => document.getElementById('create-market-form').scrollIntoView({ behavior: 'smooth' })}>
              + New Market
            </button>
          </div>
          {markets.length === 0 ? (
            <div className="empty-state">
              <h3>No markets yet</h3>
              <p>Be the first to create one — use the form below.</p>
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

        <section className="leaderboard-section" style={{ marginBottom: '32px' }}>
          <div className="dashboard-header" style={{ marginBottom: '16px' }}>
            <h2 className="section-title" style={{ color: '#f8fafb' }}>Leaderboard</h2>
          </div>
          {leaderboard.length === 0 ? (
            <p style={{ color: 'rgba(255,255,255,0.5)', margin: 0 }}>No scores yet — resolve a market to get started.</p>
          ) : (
            <ol className="leaderboard-list">
              {leaderboard.map((entry, idx) => (
                <li key={entry.user_id} className={`leaderboard-row ${entry.score > 0 ? 'leaderboard-won' : 'leaderboard-lost'}`}>
                  <span className="leaderboard-rank">#{idx + 1}</span>
                  <span className="leaderboard-name">{entry.display_name || entry.email?.split('@')[0] || `Player ${idx + 1}`}</span>
                  <span className="leaderboard-result" style={{ color: entry.score > 0 ? 'var(--secondary)' : 'rgba(255,255,255,0.5)' }}>
                    {entry.score > 0 ? '+' : ''}{entry.score} pts
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <form id="create-market-form" className="create-form" onSubmit={createMarket} style={{ marginBottom: '32px' }}>
          <div className="dashboard-header">
            <h2 className="dashboard-title" style={{ fontSize: '24px' }}>Create New Market</h2>
          </div>
          <div className="form-row">
            <label className="label">
              Market Question
              <input
                type="text"
                value={newMarketTitle}
                onChange={(e) => setNewMarketTitle(e.target.value)}
                placeholder="Will Sam go to the gym tomorrow?"
                required
              />
            </label>
          </div>
          <button type="submit" className="button" disabled={submitting}>
            {submitting ? 'Creating...' : 'Create Market'}
          </button>
        </form>
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">
        <Link href="/" className="bottom-nav-item">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span>Home</span>
        </Link>
        <Link href="/groups" className="bottom-nav-item bottom-nav-active">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <span>Groups</span>
        </Link>
        <Link href="/markets" className="bottom-nav-item">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>
          <span>Markets</span>
        </Link>
      </nav>
    </div>
  );
}
