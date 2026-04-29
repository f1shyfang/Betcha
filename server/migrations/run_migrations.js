const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function run() {
  const sqlPath = path.join(__dirname, '001_create_tables.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const client = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/betcha_dev' });
  await client.connect();
  try {
    await client.query(sql);
    console.log('Migrations applied');
  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    await client.end();
  }
}

run().catch(e => { console.error(e); process.exit(1); });
