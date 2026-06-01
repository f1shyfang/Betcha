import { describe, it, expect, afterAll } from 'vitest';

const { query, pool } = require('../server/db');

afterAll(async () => { await pool.end(); });

describe('012_exchange_leverage schema', () => {
  it('adds positions.leverage with default 1', async () => {
    const { rows } = await query(
      `SELECT column_default FROM information_schema.columns WHERE table_name='positions' AND column_name='leverage'`);
    expect(rows.length).toBe(1);
    expect(rows[0].column_default).toContain('1');
  });

  it('sets market_exchange_config.max_leverage default to 10', async () => {
    const { rows } = await query(
      `SELECT column_default FROM information_schema.columns WHERE table_name='market_exchange_config' AND column_name='max_leverage'`);
    expect(rows[0].column_default).toContain('10');
  });
});
