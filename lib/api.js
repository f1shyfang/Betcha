// Frontend API client — calls backend endpoints. Auth travels via the Better Auth
// session cookie, which is sent automatically on same-origin requests.

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

function generateIdempotencyKey(prefix = 'idemp') {
  const webCrypto = globalThis?.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function apiUrl(path) {
  // In-browser requests should stay same-origin so they share the session cookie.
  if (typeof window !== 'undefined') return path;
  return `${API_URL}${path}`;
}

export async function resolveMarket(marketId, outcome, method = 'creator', reason = '', evidenceImageUrl = '') {
  const response = await fetch(apiUrl(`/api/markets/${marketId}/resolve`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': generateIdempotencyKey('resolve'),
    },
    body: JSON.stringify({ outcome, method, reason, evidence_image_url: evidenceImageUrl }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to resolve market');
  }

  return response.json();
}

export async function getMarket(marketId) {
  const response = await fetch(apiUrl(`/api/markets/${marketId}`));
  if (!response.ok) {
    throw new Error('Failed to fetch market');
  }
  return response.json();
}

export async function getMarkets(groupId) {
  const response = await fetch(apiUrl(`/api/markets?group_id=${encodeURIComponent(groupId)}`));
  if (!response.ok) {
    throw new Error('Failed to fetch markets');
  }
  return response.json();
}

export async function createMarket({ title, groupId, type = 'binary', resolveBy }) {
  const response = await fetch(apiUrl('/api/markets'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': generateIdempotencyKey('market'),
    },
    body: JSON.stringify({ title, group_id: groupId, type, resolve_by: resolveBy }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create market');
  }

  return response.json();
}

export async function getPredictions(marketId) {
  const response = await fetch(apiUrl(`/api/markets/${marketId}/predictions`));
  if (!response.ok) {
    throw new Error('Failed to fetch predictions');
  }
  return response.json();
}

export async function placePrediction(marketId, choice, stakePoints) {
  const response = await fetch(apiUrl(`/api/markets/${marketId}/predictions`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': generateIdempotencyKey('prediction'),
    },
    body: JSON.stringify({ choice, stake_points: stakePoints }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to place prediction');
  }

  return response.json();
}

export async function getInvites(groupId) {
  const response = await fetch(apiUrl(`/api/groups/${groupId}/invites`));
  if (!response.ok) {
    throw new Error('Failed to fetch invites');
  }
  return response.json();
}

export async function createInvite(groupId, expiresInHours = 72) {
  const response = await fetch(apiUrl(`/api/groups/${groupId}/invites`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expires_in_hours: expiresInHours }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create invite');
  }

  return response.json();
}

export async function getLeaderboard(groupId) {
  const response = await fetch(apiUrl(`/api/groups/${groupId}/leaderboard`));
  if (!response.ok) {
    throw new Error('Failed to fetch leaderboard');
  }
  return response.json();
}
