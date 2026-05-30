import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { authClient } from '../lib/authClient';

export default function JoinPage() {
  const router = useRouter();
  const { token } = router.query;
  const [status, setStatus] = useState('loading'); // loading | ready | joining | success | error | notoken
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!router.isReady) return;
    if (!token) {
      setStatus('notoken');
      return;
    }

    const tryAutoJoin = async () => {
      const { data: sess } = await authClient.getSession();
      if (!sess?.session) {
        setStatus('ready');
        return;
      }
      joinGroup(token);
    };

    tryAutoJoin();
  }, [router.isReady, token]);

  const joinGroup = async (joinToken) => {
    setStatus('joining');
    try {
      const res = await fetch('/api/groups/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: joinToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to join group.');
        setStatus('error');
        return;
      }
      if (data.group_id) {
        router.push(`/groups/${data.group_id}`);
      } else {
        router.push('/groups');
      }
    } catch {
      setErrorMsg('Network error. Please try again.');
      setStatus('error');
    }
  };

  const handleAuthAndJoin = (path) => {
    router.push(`${path}?redirect=/join?token=${token}`);
  };

  return (
    <main className="page">
      <Head>
        <title>Join Group - Betcha</title>
      </Head>

      <header className="topbar" aria-label="Primary navigation">
        <div className="brand-lockup">
          <span className="brand-mark">B</span>
          <div>
            <div className="brand-name">Betcha</div>
            <div className="brand-tag">Social prediction markets for friends</div>
          </div>
        </div>
      </header>

      <section className="quick-create-section" style={{ maxWidth: '560px', width: '100%', justifySelf: 'center' }}>
        {status === 'loading' && (
          <div className="quick-create-header">
            <h2>Joining group...</h2>
          </div>
        )}

        {status === 'joining' && (
          <div className="quick-create-header">
            <h2>Joining group...</h2>
            <p className="subhead">Just a moment.</p>
          </div>
        )}

        {status === 'notoken' && (
          <div className="quick-create-header">
            <h2>Invalid invite link</h2>
            <p className="subhead">This invite link is missing a token. Ask your friend to generate a new one.</p>
          </div>
        )}

        {status === 'error' && (
          <div className="quick-create-header">
            <h2>Could not join group</h2>
            <p className="subhead">{errorMsg}</p>
            <Link href="/groups" className="button" style={{ display: 'inline-flex', marginTop: '8px' }}>Go to My Groups</Link>
          </div>
        )}

        {status === 'ready' && (
          <>
            <div className="quick-create-header">
              <h2>You have been invited to Betcha</h2>
              <p className="subhead">Sign up or log in to join the group and start predicting.</p>
            </div>
            <div className="form-row">
              <button className="button" onClick={() => handleAuthAndJoin('/signup')}>
                Create account
              </button>
              <button className="button button-secondary" onClick={() => handleAuthAndJoin('/login')}>
                Log in
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
