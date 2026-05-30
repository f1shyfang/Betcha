import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { authClient } from '../lib/authClient';

export default function LoginPage() {
  const router = useRouter();
  const { data: sessionData } = authClient.useSession();
  const session = sessionData?.session || null;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (router.query.created === 'true') {
      setMessage('Account created — please log in.');
    }
  }, [router.query.created]);

  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const { error: signInError } = await authClient.signIn.email({
        email: email.trim(),
        password,
      });
      if (signInError) throw new Error(signInError.message || 'Authentication failed.');
      setMessage('Logged in successfully. Redirecting...');
      setPassword('');
      const dest = router.query.redirect || '/groups';
      setTimeout(() => router.push(dest), 800);
    } catch (err) {
      setError(err.message || 'Authentication failed.');
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
        <title>Login - Betcha</title>
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
          <h2>{session ? 'You are logged in' : 'Login to Betcha'}</h2>
          <p className="subhead">Use your account to create and join prediction markets.</p>
        </div>

        {!session ? (
          <form className="create-form" onSubmit={handleAuth}>
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
              <button className="button" type="submit" disabled={loading}>
                {loading ? 'Please wait...' : 'Login'}
              </button>
              <Link className="button button-ghost" href="/signup">
                Need an account? Sign up
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
