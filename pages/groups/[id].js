import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import supabase from '../../lib/supabase';
import Head from 'next/head';
import Link from 'next/link';

export default function GroupDetail() {
  const router = useRouter();
  const { id } = router.query;
  const [group, setGroup] = useState(null);
  const [markets, setMarkets] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteToken, setInviteToken] = useState(null);
  const [newMarketTitle, setNewMarketTitle] = useState('');

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
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/markets', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}` 
      },
      body: JSON.stringify({ group_id: id, title: newMarketTitle })
    });
    if (res.ok) {
      setNewMarketTitle('');
      fetchGroup();
    }
  };

  if (loading) return <div className="page">Loading...</div>;

  return (
    <div className="page">
      <Head><title>Group Markets - Betcha</title></Head>
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">B</span>
          <div className="brand-name">Betcha</div>
        </div>
      </header>

      <main>
        <div className="dashboard-header" style={{ marginBottom: '24px' }}>
          <div className="dashboard-title-area">
            <h1 className="dashboard-title">{group?.name || 'Group Dashboard'}</h1>
          </div>
          <div className="dashboard-actions">
            <button className="button button-secondary button-sm" onClick={createInvite}>
              Generate Invite Link
            </button>
          </div>
        </div>

        {inviteToken && (
          <div className="invite-banner" style={{ marginBottom: '32px' }}>
            <span className="invite-label">Invite Token</span>
            <span className="invite-link">{inviteToken}</span>
            <span style={{fontSize: '12px', color: 'var(--muted)'}}>POST /api/groups/join</span>
          </div>
        )}

        <form className="create-form" onSubmit={createMarket} style={{ marginBottom: '32px' }}>
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
          <button type="submit" className="button">Create Market</button>
        </form>

        <section>
          <div className="dashboard-header" style={{ marginBottom: '16px' }}>
            <h2 className="dashboard-title" style={{ fontSize: '24px' }}>Live Markets</h2>
          </div>
          {markets.length === 0 ? (
            <div className="empty-state">
              <h3>No markets yet</h3>
              <p>Create one above to get started.</p>
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

        <section style={{ marginTop: '32px' }}>
          <div className="dashboard-header" style={{ marginBottom: '16px' }}>
            <h2 className="dashboard-title" style={{ fontSize: '24px' }}>Leaderboard</h2>
          </div>
          {leaderboard.length === 0 ? (
            <div className="empty-state">
              <p>No scores yet.</p>
            </div>
          ) : (
            <div className="cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
              {leaderboard.map((entry, idx) => (
                <div key={entry.user_id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>
                    <strong>#{idx + 1}</strong> User {entry.user_id.substring(0, 4)}
                  </span>
                  <strong style={{ fontFamily: 'Geist, sans-serif', fontSize: '20px', color: 'var(--secondary)' }}>{entry.score}</strong>
                </div>
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
