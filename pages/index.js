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
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">Betcha</div>
          <h1>Private prediction markets for friends.</h1>
          <p className="subhead">
            Turn ordinary moments into light stakes, real follow-through, and
            group rituals. Betcha is invite-only, social-first, and built for
            accountability and fun.
          </p>

          <form className="form" onSubmit={submit}>
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
              Name (optional)
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ada Lovelace"
              />
            </label>
            <button className="button" type="submit" disabled={status === 'loading'}>
              {status === 'loading' ? 'Submitting...' : 'Join the waitlist'}
            </button>
          </form>

          {message && (
            <div className={`message ${status}`} role="status">
              {message}
            </div>
          )}

          <div className="meta">
            Score-only in v1. No money custody. Launch invites first.
          </div>
        </div>

        <div className="hero-panel">
          <div className="panel-title">The Betcha loop</div>
          <ol className="panel-steps">
            <li>
              <strong>Create a market</strong>
              <span>Gym streak, chores, or game night outcomes.</span>
            </li>
            <li>
              <strong>Invite your group</strong>
              <span>Private by default. Share a single link.</span>
            </li>
            <li>
              <strong>Make predictions</strong>
              <span>Light stakes, fast feedback, real accountability.</span>
            </li>
            <li>
              <strong>Resolve + leaderboard</strong>
              <span>Score-only wins to keep it simple and social.</span>
            </li>
          </ol>
        </div>
      </section>

      <section className="cards">
        <div className="card">
          <h3>Accountability-first</h3>
          <p>Gym, chores, and weekly rituals stay on track with friendly stakes.</p>
        </div>
        <div className="card">
          <h3>Invite-only groups</h3>
          <p>Private markets, shared in group chats, no public noise.</p>
        </div>
        <div className="card">
          <h3>Season-ready</h3>
          <p>Built to evolve into recurring seasons once the core loop sticks.</p>
        </div>
      </section>

      <section className="use-cases">
        <div className="use-case">
          <h4>Accountability</h4>
          <p>12-week gym seasons, roommate chores, daily habits.</p>
        </div>
        <div className="use-case">
          <h4>Fun</h4>
          <p>Game night outcomes, social dares, friendly rivalry.</p>
        </div>
        <div className="use-case">
          <h4>Social rituals</h4>
          <p>Recurring markets that keep the group talking offline.</p>
        </div>
      </section>
    </main>
  );
}
