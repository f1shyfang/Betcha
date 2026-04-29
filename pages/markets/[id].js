import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import supabase from '../../lib/supabase';
import Head from 'next/head';
import { resolveMarket } from '../../lib/api';

export default function MarketDetail() {
  const router = useRouter();
  const { id } = router.query;
  const [market, setMarket] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) fetchMarket();
  }, [id]);

  const fetchMarket = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push('/');

      // For simplicity, just refetch all from group and find it, or we could add a single GET /api/markets/:id
      const res = await fetch(`/api/markets`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const found = data.find(m => m.id === id);
        setMarket(found);
      }
      setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  const placePrediction = async (choice) => {
    const { data: { session } } = await supabase.auth.getSession();
    const idempKey = `pred-${id}-${session.user.id}-${Date.now()}`;
    await fetch(`/api/markets/${id}/predictions`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        'idempotency-key': idempKey
      },
      body: JSON.stringify({ choice })
    });
    fetchMarket();
  };

  const handleResolve = async (outcome) => {
    try {
      await resolveMarket(id, outcome);
      fetchMarket();
    } catch (e) {
      alert(e.message);
    }
  };

  if (loading) return <div className="page">Loading...</div>;
  if (!market) return <div className="page">Market not found or unauthorized.</div>;

  return (
    <div className="page">
      <Head><title>{market.title} - Betcha</title></Head>
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">B</span>
          <div className="brand-name">Betcha</div>
        </div>
      </header>

      <main style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
        <button onClick={() => router.push(`/groups/${market.group_id}`)} style={{marginBottom: '1rem', background:'none', border:'none', cursor:'pointer', color:'#FF5A5F'}}>
          ← Back to Group
        </button>

        <h1>{market.title}</h1>
        <p>Status: <strong>{market.state}</strong></p>

        {market.state === 'open' && (
          <section style={{ margin: '2rem 0', display:'flex', gap:'1rem' }}>
            <button className="button" onClick={() => placePrediction(true)}>Predict YES</button>
            <button className="button" style={{background:'#555'}} onClick={() => placePrediction(false)}>Predict NO</button>
          </section>
        )}

        {market.state === 'open' && (
          <section style={{ margin: '2rem 0', padding:'1rem', border:'1px solid #ccc', borderRadius:'8px' }}>
            <h2>Resolve Market (Creator only)</h2>
            <div style={{display:'flex', gap:'1rem', marginTop:'1rem'}}>
              <button className="button" onClick={() => handleResolve(true)}>Resolve YES</button>
              <button className="button" style={{background:'#555'}} onClick={() => handleResolve(false)}>Resolve NO</button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
