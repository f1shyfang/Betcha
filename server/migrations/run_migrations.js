const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function run() {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const migrationSourceDir = fs.existsSync(migrationsDir) ? migrationsDir : __dirname;
  const client = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/betcha_dev' });
  const migrationFiles = fs
    .readdirSync(migrationSourceDir)
    .filter((file) => file.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  await client.connect();
  try {
    for (const fileName of migrationFiles) {
      const sql = fs.readFileSync(path.join(migrationSourceDir, fileName), 'utf8');
      await client.query(sql);
      console.log(`Applied migration ${fileName}`);
    }
    console.log('Migrations applied');
  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    await client.end();
  }
}

run().catch(e => { console.error(e); process.exit(1); });
