// Frontend API client — calls backend endpoints with auth token if present
import supabase from './supabase';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

function generateIdempotencyKey(prefix = 'idemp') {
  const webCrypto = globalThis?.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

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
  const idempKey = generateIdempotencyKey('resolve');
  const headers = {
    'Content-Type': 'application/json',
    'Idempotency-Key': idempKey,
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

export async function getMarket(marketId) {
  const token = await getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` })
  };

  const response = await fetch(`${API_URL}/api/markets/${marketId}`, {
    headers
  });

  if (!response.ok) {
    throw new Error('Failed to fetch market');
  }

  return response.json();
}

export async function getMarkets(groupId) {
  const token = await getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` })
  };

  const response = await fetch(`${API_URL}/api/markets?group_id=${encodeURIComponent(groupId)}`, {
    headers
  });

  if (!response.ok) {
    throw new Error('Failed to fetch markets');
  }

  return response.json();
}

export async function createMarket({ title, groupId, type = 'binary', resolveBy }) {
  const token = await getAuthToken();
  if (!token) {
    throw new Error('Please sign in to create a market.');
  }
  const idempKey = generateIdempotencyKey('market');
  const headers = {
    'Content-Type': 'application/json',
    'Idempotency-Key': idempKey,
    ...(token && { Authorization: `Bearer ${token}` })
  };

  const response = await fetch(`${API_URL}/api/markets`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title, group_id: groupId, type, resolve_by: resolveBy })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Failed to create market');
  }

  return response.json();
}

export async function getPredictions(marketId) {
  const token = await getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` })
  };

  const response = await fetch(`${API_URL}/api/markets/${marketId}/predictions`, {
    headers
  });

  if (!response.ok) {
    throw new Error('Failed to fetch predictions');
  }

  return response.json();
}

export async function placePrediction(marketId, choice, stakePoints) {
  const token = await getAuthToken();
  const idempKey = generateIdempotencyKey('prediction');
  const headers = {
    'Content-Type': 'application/json',
    'Idempotency-Key': idempKey,
    ...(token && { Authorization: `Bearer ${token}` })
  };

  const response = await fetch(`${API_URL}/api/markets/${marketId}/predictions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ choice, stake_points: stakePoints })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Failed to place prediction');
  }

  return response.json();
}

export async function getInvites(groupId) {
  const token = await getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` })
  };

  const response = await fetch(`${API_URL}/api/groups/${groupId}/invites`, {
    headers
  });

  if (!response.ok) {
    throw new Error('Failed to fetch invites');
  }

  return response.json();
}

export async function createInvite(groupId, expiresInHours = 72) {
  const token = await getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` })
  };

  const response = await fetch(`${API_URL}/api/groups/${groupId}/invites`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expires_in_hours: expiresInHours })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Failed to create invite');
  }

  return response.json();
}

export async function getLeaderboard(groupId) {
  const token = await getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` })
  };

  const response = await fetch(`${API_URL}/api/groups/${groupId}/leaderboard`, {
    headers
  });

  if (!response.ok) {
    throw new Error('Failed to fetch leaderboard');
  }

  return response.json();
}
