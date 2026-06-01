import { describe, it, expect, afterAll } from 'vitest';

const { query, pool } = require('../server/db');

afterAll(async () => {
  await pool.end();
});

// True if some index on `table` has `column` as its leading key column — that's
// what makes a `WHERE column = $1` lookup index-backed instead of a seq scan.
async function hasLeadingIndex(table, column) {
  const { rows } = await query(
    `SELECT 1
     FROM pg_index ix
     JOIN pg_class t ON t.oid = ix.indrelid
     JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ix.indkey[0]
     WHERE t.relname = $1 AND a.attname = $2
     LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

describe('performance indexes (migration 009)', () => {
  it('ledger_entries has a leading index on user_id (for balance SUM)', async () => {
    expect(await hasLeadingIndex('ledger_entries', 'user_id')).toBe(true);
  });

  it('markets has a leading index on group_id (for leaderboard + markets list)', async () => {
    expect(await hasLeadingIndex('markets', 'group_id')).toBe(true);
  });
});
