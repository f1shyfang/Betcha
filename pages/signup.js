import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { authClient } from '../lib/authClient';

export default function SignupPage() {
  const router = useRouter();
  const { data: sessionData } = authClient.useSession();
  const session = sessionData?.session || null;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSignUp = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      // Better Auth creates the auth user and (via the create hook in lib/auth.js)
      // mirrors it into the domain `users` table with display_name = name.
      const { error: signUpError } = await authClient.signUp.email({
        email: email.trim(),
        password,
        name: displayName.trim() || email.trim().split('@')[0],
      });
      if (signUpError) throw new Error(signUpError.message || 'Sign up failed.');

      setMessage('Account created! Redirecting...');
      setPassword('');
      const dest = router.query.redirect || '/groups';
      setTimeout(() => router.push(dest), 800);
    } catch (err) {
      setError(err.message || 'Sign up failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    setError('');
    setMessage('');
    await authClient.signOut();
  };

  return (
    <main className="page">
      <Head>
        <title>Sign Up - Betcha</title>
      </Head>

      <header className="topbar" aria-label="Primary navigation">
        <div className="brand-lockup">
          <span className="brand-mark">B</span>
          <div>
            <div className="brand-name">Betcha</div>
            <div className="brand-tag">Social prediction markets for friends</div>
          </div>
        </div>
        <Link className="topbar-link" href="/">
          Back Home
        </Link>
      </header>

      <section className="quick-create-section" style={{ maxWidth: '720px', width: '100%', justifySelf: 'center' }}>
        <div className="quick-create-header">
          <h2>{session ? 'You are already logged in' : 'Create your Betcha account'}</h2>
          <p className="subhead">Sign up to create and join prediction markets.</p>
        </div>

        {!session ? (
          <form className="create-form" onSubmit={handleSignUp}>
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
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  minLength={6}
                  required
                />
              </label>
            </div>

            <div className="form-row">
              <label className="label">
                Display Name <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="How others will see you"
                />
              </label>
            </div>

            <div className="form-row">
              <button className="button" type="submit" disabled={loading}>
                {loading ? 'Please wait...' : 'Sign up'}
              </button>
              <Link className="button button-ghost" href="/login">
                Already have an account? Login
              </Link>
            </div>
          </form>
        ) : (
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button className="button button-secondary" type="button" onClick={handleSignOut}>
              Logout
            </button>
            <button className="button" type="button" onClick={() => router.push('/groups')}>
              Go to Groups
            </button>
            <button className="button" type="button" onClick={() => router.push('/markets')}>
              Go to Markets
            </button>
          </div>
        )}

        {message && <div className="message success" role="status">{message}</div>}
        {error && <div className="message error" role="alert">{error}</div>}
      </section>
    </main>
  );
}
