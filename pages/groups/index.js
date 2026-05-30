import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { authClient } from '../../lib/authClient';
import Head from 'next/head';
import Link from 'next/link';

export default function GroupsIndex() {
  const router = useRouter();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newGroupName, setNewGroupName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [inviteToken, setInviteToken] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinMessage, setJoinMessage] = useState('');
  const [joinError, setJoinError] = useState('');

  useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    try {
      const { data: sess } = await authClient.getSession();
      if (!sess?.session) return router.push('/');

      const res = await fetch('/api/groups');
      if (res.ok) {
        const data = await res.json();
        setGroups(data);
      }
      setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  const createGroup = async (e) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      const { data: sess } = await authClient.getSession();
      if (!sess?.session) {
        router.push('/login');
        return;
      }
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: newGroupName.trim() })
      });
      if (res.ok) {
        setNewGroupName('');
        fetchGroups();
      } else {
        const data = await res.json();
        setCreateError(data.error || 'Failed to create group');
      }
    } catch (err) {
      console.error(err);
      setCreateError('Failed to create group');
    } finally {
      setCreating(false);
    }
  };

  const joinGroup = async (e) => {
    e.preventDefault();
    if (!inviteToken.trim()) return;

    setJoining(true);
    setJoinError('');
    setJoinMessage('');

    try {
      const { data: sess } = await authClient.getSession();
      if (!sess?.session) {
        router.push('/login');
        return;
      }

      const res = await fetch('/api/groups/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ token: inviteToken.trim() })
      });

      const data = await res.json();
      if (!res.ok) {
        setJoinError(data.error || 'Failed to join group');
        return;
      }

      setJoinMessage('Joined group successfully.');
      setInviteToken('');
      await fetchGroups();
      if (data.group_id) {
        router.push(`/groups/${data.group_id}`);
      }
    } catch (err) {
      console.error(err);
      setJoinError('Failed to join group');
    } finally {
      setJoining(false);
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '16px' }}>
            {[1, 2, 3].map((n) => (
              <div key={n} className="skeleton-shimmer" style={{ height: '96px', borderRadius: '12px' }} />
            ))}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="page">
      <Head><title>My Groups - Betcha</title></Head>
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">B</span>
          <div className="brand-name">Betcha</div>
        </div>
      </header>

      <main>
        <div className="dashboard-header" style={{ marginBottom: '24px' }}>
          <div className="dashboard-title-area">
            <h1 className="dashboard-title">My Groups</h1>
          </div>
        </div>

        <form className="create-form" onSubmit={createGroup} style={{ marginBottom: '32px' }}>
          <div className="dashboard-header">
            <h2 className="dashboard-title" style={{ fontSize: '20px' }}>Create New Group</h2>
          </div>
          <div className="form-row">
            <label className="label">
              Group Name
              <input 
                type="text" 
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Roommates, Gym Buddies, etc."
                required 
              />
            </label>
          </div>
          <button type="submit" className="button" disabled={creating}>
            {creating ? 'Creating...' : 'Create Group'}
          </button>
          {createError && (
            <div className="message error" role="alert">{createError}</div>
          )}
        </form>

        <form className="create-form" onSubmit={joinGroup} style={{ marginBottom: '32px' }}>
          <div className="dashboard-header">
            <h2 className="dashboard-title" style={{ fontSize: '20px' }}>Join Existing Group</h2>
          </div>
          <div className="form-row">
            <label className="label">
              Invite Token
              <input
                type="text"
                value={inviteToken}
                onChange={(e) => setInviteToken(e.target.value)}
                placeholder="Paste invite token"
                required
              />
            </label>
          </div>
          <button type="submit" className="button button-secondary" disabled={joining}>
            {joining ? 'Joining...' : 'Join Group'}
          </button>
          {joinMessage && (
            <div className="message success" role="status">{joinMessage}</div>
          )}
          {joinError && (
            <div className="message error" role="alert">{joinError}</div>
          )}
        </form>

        <section>
          {groups.length === 0 ? (
            <div className="empty-state">
              <h3>No groups yet</h3>
              <p>Create one above or ask a friend for an invite link.</p>
            </div>
          ) : (
            <div className="cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' }}>
              {groups.map(g => (
                <article key={g.id} className="card" onClick={() => router.push(`/groups/${g.id}`)} style={{cursor:'pointer'}}>
                  <h3>{g.name}</h3>
                  <p style={{marginTop: '8px', fontSize: '14px', color: 'var(--muted)'}}>
                    Created {new Date(g.created_at).toLocaleDateString()}
                  </p>
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
