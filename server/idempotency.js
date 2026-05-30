const { query } = require('./db');

async function getIdempotentResponse(key) {
  if (!key) return null;
  const { rows } = await query(
    'SELECT response FROM idempotency_keys WHERE key = $1 LIMIT 1',
    [key]
  );
  return rows[0]?.response || null;
}

async function storeIdempotentResponse(key, response) {
  if (!key) return;
  await query(
    `INSERT INTO idempotency_keys (key, response)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET response = EXCLUDED.response`,
    [key, response]
  );
}

module.exports = { getIdempotentResponse, storeIdempotentResponse };
