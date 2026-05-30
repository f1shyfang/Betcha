const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || 'postgres://localhost:5432/betcha_dev';
// Neon (and any sslmode=require host) needs TLS. Local dev does not.
const needsSsl = /neon\.tech|sslmode=require/i.test(connectionString);

const pool = new Pool({
  connectionString,
  ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {})
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect()
};
