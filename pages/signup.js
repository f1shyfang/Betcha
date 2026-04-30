import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import supabase from '../lib/supabase';

export default function SignupPage() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    const loadSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (mounted) {
        setSession(data?.session || null);
      }
    };

    loadSession();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
    });

    return () => {
      mounted = false;
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  const handleSignUp = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (signUpError) throw signUpError;
      setMessage('Account created! Redirecting to login...');
      setPassword('');
      const redirectParam = router.query.redirect ? `&redirect=${encodeURIComponent(router.query.redirect)}` : '';
      setTimeout(() => router.push(`/login?created=true${redirectParam}`), 800);
    } catch (err) {
      setError(err.message || 'Sign up failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    setError('');
    setMessage('');
    await supabase.auth.signOut();
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
