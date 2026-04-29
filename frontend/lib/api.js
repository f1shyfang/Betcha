// Frontend API client — calls backend endpoints with auth token if present
import supabase from './supabase';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

async function getAuthToken() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.warn('Failed to get session', error);
      return null;
    }
    return data?.session?.access_token;
  } catch (e) {
    console.warn('Auth token fetch error', e);
    return null;
  }
}

export async function resolveMarket(marketId, outcome, method = 'creator', reason = '') {
  const token = await getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` })
  };

  const response = await fetch(`${API_URL}/api/markets/${marketId}/resolve`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ outcome, method, reason })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Failed to resolve market');
  }

  return response.json();
}

export async function subscribeToMarketUpdates(marketId, callback) {
  // Optional: set up realtime subscription via Supabase
  const subscription = supabase
    .from('markets')
    .on('*', (payload) => {
      if (payload.new.id === marketId) {
        callback(payload.new);
      }
    })
    .subscribe();

  return subscription;
}

export async function getMarkets(groupId) {
  // Call backend to fetch markets for group (when available)
  const token = await getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` })
  };

  const response = await fetch(`${API_URL}/api/groups/${groupId}/markets`, {
    headers
  });

  if (!response.ok) {
    throw new Error('Failed to fetch markets');
  }

  return response.json();
}
