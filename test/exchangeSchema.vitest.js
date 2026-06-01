import { describe, it, expect, afterAll } from 'vitest';

const { query, pool } = require('../server/db');

async function columnExists(table, column) {
  const { rows } = await query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return rows.length === 1;
}
async function tableExists(table) {
  const { rows } = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
    [table]
  );
  return rows.length === 1;
}

describe('010_exchange_markets schema', () => {
  it('adds markets.mechanism defaulting to quick', async () => {
    expect(await columnExists('markets', 'mechanism')).toBe(true);
    const { rows } = await query(
      `SELECT column_default FROM information_schema.columns
       WHERE table_name = 'markets' AND column_name = 'mechanism'`
    );
    expect(rows[0].column_default).toContain('quick');
  });

  it('creates the exchange tables', async () => {
    for (const t of ['market_exchange_config', 'orders', 'trades', 'positions', 'insurance_pool']) {
      expect(await tableExists(t)).toBe(true);
    }
  });

  it('exchange tables have the expected columns (positions.shares, orders.leverage)', async () => {
    expect(await columnExists('positions', 'shares')).toBe(true);
    expect(await columnExists('orders', 'leverage')).toBe(true);
  });
});

afterAll(async () => {
  await pool.end();
});
