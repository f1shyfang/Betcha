import { defineConfig } from 'vitest/config';

// Integration tests run against an ephemeral Neon branch (see .env.test.local).
// They share one database, so we run serially with a single fork and rely on
// unique per-suite IDs + teardown for isolation. Neon computes can cold-start,
// so timeouts are generous.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./test/setup.js'],
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 30000,
    hookTimeout: 30000,
    include: ['test/**/*.vitest.js'],
  },
});
