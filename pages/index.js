import { useState } from 'react';
import { useRouter } from 'next/router';
import { createMarket } from '../lib/api';

export default function Home() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');

  // Quick-create market state
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [quickTitle, setQuickTitle] = useState('');
  const [quickGroupId, setQuickGroupId] = useState('');
  const [quickCreating, setQuickCreating] = useState(false);
  const [quickError, setQuickError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setStatus('loading');
    setMessage('');

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
      const res = await fetch(`${apiUrl}/api/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, source: 'next_waitlist' })
      });
      const data = await res.json();

      if (res.ok) {
        setStatus('success');
        setMessage(data.message || 'You are in. Welcome to the list.');
        setEmail('');
        setName('');
      } else {
        setStatus('error');
        setMessage(data.error || 'Something went wrong.');
      }
    } catch (err) {
      setStatus('error');
      setMessage('Network error. Try again.');
    }
  };

  const handleQuickCreate = async (e) => {
    e.preventDefault();
    if (!quickTitle.trim()) return;
    setQuickCreating(true);
    setQuickError('');
    try {
      const result = await createMarket({
        title: quickTitle.trim(),
        groupId: quickGroupId || undefined,
      });
      if (result.market?.group_id) {
        router.push(`/groups/${result.market.group_id}`);
      } else if (result.market?.id) {
        router.push(`/markets/${result.market.id}`);
      }
    } catch (err) {
      setQuickError(err.message || 'Failed to create market');
    } finally {
      setQuickCreating(false);
    }
  };

  return (
    <main className="page">
      <header className="topbar" aria-label="Primary navigation">
        <div className="brand-lockup">
          <span className="brand-mark">B</span>
          <div>
            <div className="brand-name">Betcha</div>
            <div className="brand-tag">Social prediction markets for friends</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <a className="topbar-link" href="/login">
            Login
          </a>
          <a className="topbar-link" href="/signup">
            Sign up
          </a>
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">Invite-only beta</div>
          <h1>Make markets on anything. Keep it fun. Keep it real.</h1>
          <p className="subhead">
            Betcha turns group accountability into something people actually want to
            check. Build a market, invite your friends, watch the odds move, and
            resolve the result together.
          </p>

          <div className="hero-stats" aria-label="Product highlights">
            <div>
              <strong>Private by default</strong>
              <span>Share one link with your group.</span>
            </div>
            <div>
              <strong>Score-only v1</strong>
              <span>No money custody. Less friction.</span>
            </div>
            <div>
              <strong>Made for rituals</strong>
              <span>Chores, habits, game night, and more.</span>
            </div>
          </div>

          <form id="join" className="form" onSubmit={submit}>
            <div className="form-row">
              <label className="label">
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@domain.com"
                  required
                />
              </label>
              <label className="label">
                Name
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ada"
                />
              </label>
            </div>
            <button className="button" type="submit" disabled={status === 'loading'}>
              {status === 'loading' ? 'Joining...' : 'Join the waitlist'}
            </button>
          </form>

          {message && (
            <div className={`message ${status}`} role="status" aria-live="polite">
              {message}
            </div>
          )}

          <p className="meta">
            Invite-only first. Score-only at launch. Built for accountability and fun,
            not finance bros.
          </p>
        </div>

        <div className="hero-panel" aria-label="Example markets">
          <div className="panel-title">What Betcha feels like</div>
          <div className="market-stack">
            <article className="market-card">
              <div className="market-head">
                <span className="market-pill live">Live</span>
                <span className="market-chip">Friends only</span>
              </div>
              <h3>Will Sam hit the gym 4 times this week?</h3>
              <div className="odds-row">
                <div><strong>62%</strong><span>Yes</span></div>
                <div><strong>38%</strong><span>No</span></div>
              </div>
            </article>
            <article className="market-card accent">
              <div className="market-head">
                <span className="market-pill">Season 3</span>
                <span className="market-chip">Accountability</span>
              </div>
              <h3>Will the apartment be clean by Friday night?</h3>
              <div className="market-footer">
                <span>8 participants</span>
                <span>Last updated 2m ago</span>
              </div>
            </article>
            <article className="market-card dark">
              <div className="market-head">
                <span className="market-pill">Resolved</span>
                <span className="market-chip">Game night</span>
              </div>
              <h3>Will Mia win the trivia rematch?</h3>
              <div className="market-footer">
                <span>Outcome: No</span>
                <span>Leaderboards updated</span>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="quick-create-section" aria-label="Quick create market">
        <div className="quick-create-header">
          <h2>Create a market in seconds</h2>
          <p className="subhead">Type a question, pick a group, and you're live.</p>
        </div>
        {!showQuickCreate ? (
          <button className="button" onClick={() => setShowQuickCreate(true)}>
            + Create a market
          </button>
        ) : (
          <form className="create-form" onSubmit={handleQuickCreate}>
            <label className="label">
              Your market question
              <input
                type="text"
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                placeholder="Will Alex finish the project by Friday?"
                required
                autoFocus
              />
            </label>
            <label className="label">
              Group ID (optional)
              <input
                type="text"
                value={quickGroupId}
                onChange={(e) => setQuickGroupId(e.target.value)}
                placeholder="Paste a group ID from your dashboard"
              />
            </label>
            <div className="form-row">
              <button className="button" type="submit" disabled={quickCreating}>
                {quickCreating ? 'Creating...' : 'Create market'}
              </button>
              <button className="button button-ghost" type="button" onClick={() => setShowQuickCreate(false)}>
                Cancel
              </button>
            </div>
            {quickError && (
              <div className="message error" role="alert">{quickError}</div>
            )}
          </form>
        )}
      </section>

      <section className="cards" aria-label="Why Betcha">
        <div className="card">
          <h3>Accountability-first</h3>
          <p>Turn habits, chores, and plans into a shared loop people can see.</p>
        </div>
        <div className="card">
          <h3>Invite-only groups</h3>
          <p>Private markets keep the vibe small, social, and low-noise.</p>
        </div>
        <div className="card">
          <h3>Fast to start</h3>
          <p>Create a market in seconds, then let the group do the rest.</p>
        </div>
      </section>

      <section className="use-cases">
        <div className="use-case">
          <h4>Accountability</h4>
          <p>Gym streaks, chores, daily habits, and weekly check-ins.</p>
        </div>
        <div className="use-case">
          <h4>Fun</h4>
          <p>Game night outcomes, social dares, and friendly rivalry.</p>
        </div>
        <div className="use-case">
          <h4>Rituals</h4>
          <p>Recurring markets that give your group something to return to.</p>
        </div>
      </section>

    </main>
  );
}
