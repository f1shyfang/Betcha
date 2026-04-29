// Vercel Serverless Function for POST /api/markets/[id]/resolve
// Entry point: backend/api/markets/[id]/resolve.js

const { handleResolve } = require('../../src/resolveHandler');
const { createPool } = require('pg');

// Initialize DB pool and idempotency helpers on demand
let dbPool;
let idempotencyCache = {};

async function initDB() {
  if (!dbPool) {
    dbPool = createPool({ connectionString: process.env.DATABASE_URL });
  }
  return {
    getClient: async () => dbPool.connect(),
    query: (sql, params) => dbPool.query(sql, params)
  };
}

async function getIdempotentResponse(key) {
  if (!key) return null;
  return idempotencyCache[key] || null;
}

async function storeIdempotentResponse(key, response) {
  if (!key) return;
  idempotencyCache[key] = response;
  // Optional: expire after 1 hour
  setTimeout(() => delete idempotencyCache[key], 3600000);
}

export default async (req, res) => {
  // Enable CORS
  const corsOrigin = process.env.FRONTEND_URL || process.env.VERCEL_URL ? (process.env.FRONTEND_URL || `https://${process.env.VERCEL_URL}`) : '*';
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  try {
    const db = await initDB();
    const marketId = req.query.id;
    const { outcome, method = 'creator', reason = '' } = req.body || {};
    const idempKey = req.headers['idempotency-key'];

    // Optional: parse Bearer token from Authorization header for req.user
    let userId = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      // In a real app, verify the JWT here; for now just extract the claim
      // This would use Supabase auth or your own JWT validation
      try {
        const token = authHeader.slice(7);
        // TODO: verify and decode token to get userId
        // userId = decoded.sub;
      } catch (e) {
        // ignore auth errors; proceed as unauthenticated
      }
    }

    const result = await handleResolve({ marketId, outcome, method, reason, idempKey, db, getIdempotentResponse, storeIdempotentResponse, userId });
    return res.status(result.status).json(result.body);
  } catch (e) {
    console.error('Serverless function error', e);
    return res.status(500).json({ error: 'internal' });
  }
};
