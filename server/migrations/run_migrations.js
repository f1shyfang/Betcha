const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function run() {
  const sqlPath1 = path.join(__dirname, '001_create_tables.sql');
  const sql1 = fs.readFileSync(sqlPath1, 'utf8');
  const sqlPath2 = path.join(__dirname, '002_rls.sql');
  const sql2 = fs.readFileSync(sqlPath2, 'utf8');
  const client = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/betcha_dev' });
  await client.connect();
  try {
    await client.query(sql1);
    await client.query(sql2);
    console.log('Migrations applied');
  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    await client.end();
  }
}

run().catch(e => { console.error(e); process.exit(1); });
