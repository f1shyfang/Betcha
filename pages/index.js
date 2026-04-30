import { useState } from 'react';

export default function Home() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');

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

      <section className="market-ticker-section" aria-label="Example markets">
        <div className="market-ticker-label">What Betcha groups bet on</div>
        <div className="market-ticker" aria-hidden="true">
          <div className="market-ticker-track">
            {[
              'Will Sam gym 4× this week?',
              'Does the apartment stay clean til Sunday?',
              'Who wins Friday trivia?',
              'Will Alex finish the sprint by Thursday?',
              'Will Mia beat her 5K PR?',
              'Does the group actually finish the movie tonight?',
              'Will Jordan go to bed before 1am?',
              'Who picks up groceries first?',
              'Will Sam gym 4× this week?',
              'Does the apartment stay clean til Sunday?',
              'Who wins Friday trivia?',
              'Will Alex finish the sprint by Thursday?',
            ].map((q, i) => (
              <span key={i} className="market-ticker-item">{q}</span>
            ))}
          </div>
        </div>
      </section>

    </main>
  );
}
