import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import supabase from '../../lib/supabase';
import Head from 'next/head';

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

      <main style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
        <h1>Group Dashboard</h1>
        
        <section style={{ marginBottom: '2rem' }}>
          <button className="button" onClick={createInvite}>Generate Invite Link</button>
          {inviteToken && (
            <div style={{ marginTop: '1rem', padding: '1rem', background: '#f0f0f0', borderRadius: '4px' }}>
              Share this token with friends: <strong>{inviteToken}</strong>
              <br/>
              (They can join via POST /api/groups/join)
            </div>
          )}
        </section>

        <section style={{ marginBottom: '2rem' }}>
          <h2>Create New Market</h2>
          <form onSubmit={createMarket} style={{ display: 'flex', gap: '1rem' }}>
            <input 
              type="text" 
              className="input" 
              value={newMarketTitle}
              onChange={(e) => setNewMarketTitle(e.target.value)}
              placeholder="Will Sam go to the gym tomorrow?"
              required 
              style={{ flex: 1, padding: '0.5rem' }}
            />
            <button type="submit" className="button">Create</button>
          </form>
        </section>

        <section>
          <h2>Markets</h2>
          {markets.length === 0 ? <p>No markets yet.</p> : (
            <div className="market-stack">
              {markets.map(m => (
                <article key={m.id} className="market-card" onClick={() => router.push(`/markets/${m.id}`)} style={{cursor:'pointer'}}>
                  <div className="market-head">
                    <span className="market-pill live">{m.state}</span>
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

        <section style={{ marginTop: '3rem' }}>
          <h2>Leaderboard</h2>
          {leaderboard.length === 0 ? <p>No scores yet.</p> : (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {leaderboard.map((entry, idx) => (
                <li key={entry.user_id} style={{ padding: '0.5rem', borderBottom: '1px solid #ccc', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{idx + 1}. User {entry.user_id.substring(0, 8)}</span>
                  <strong>{entry.score} pts</strong>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
