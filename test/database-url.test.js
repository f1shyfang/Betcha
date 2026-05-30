// Connectivity check against the configured Postgres (Neon).
// Run: node --env-file=.env.local test/database-url.test.js

const { Client } = require('pg');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('FAIL: DATABASE_URL is not set');
    process.exit(1);
  }

  const needsSsl = /neon\.tech|sslmode=require/i.test(connectionString);
  const client = new Client({
    connectionString,
    ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });

  try {
    await client.connect();
    const { rows } = await client.query('SELECT 1 AS ok');
    if (rows[0]?.ok === 1) {
      console.log('PASS: Postgres connection successful');
    } else {
      console.error('FAIL: unexpected query result');
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('FAIL: Postgres connection failed');
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
