const db = require('./db');

async function getIdempotentResponse(key) {
  if (!key) return null;
  const res = await db.query('SELECT response FROM idempotency_keys WHERE key = $1', [key]);
  if (res.rowCount === 0) return null;
  return res.rows[0].response;
}

async function storeIdempotentResponse(key, response) {
  if (!key) return;
  await db.query('INSERT INTO idempotency_keys(key,response) VALUES($1,$2) ON CONFLICT (key) DO NOTHING', [key, response]);
}

module.exports = { getIdempotentResponse, storeIdempotentResponse };
