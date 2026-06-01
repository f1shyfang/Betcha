// Vitest setup: load the test-branch DATABASE_URL before any module that reads it.
// server/db.js resolves the connection string at require-time, so this must run first.
const dotenv = require('dotenv');
dotenv.config({ path: '.env.test.local' });

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Create .env.test.local with a Neon test-branch URL (see vitest.config.js).'
  );
}

// Guardrail: never let integration tests run against the production branch.
if (!/ci-perf-tests|ep-old-pond-a7d0kwqd/.test(process.env.DATABASE_URL)) {
  // Best-effort check; the branch host is what we provisioned for CI.
  console.warn('[test/setup] DATABASE_URL does not look like the ci-perf-tests branch.');
}
