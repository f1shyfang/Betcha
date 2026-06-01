import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uid } from './helpers.js';
const { query, pool } = require('../server/db');
const { createExchangeMarket } = require('../server/exchange/createMarket');
const { ensureInsurance, INITIAL_INSURANCE } = require('../server/exchange/insurance');

const USER = uid('ins-user');
let GROUP;

beforeAll(async () => {
  await query(
    `INSERT INTO users (id, email, starting_points) VALUES ($1,$2,2000) ON CONFLICT (id) DO NOTHING`,
    [USER, `${USER}@t.internal`]
  );
  const { rows: g } = await query(
    `INSERT INTO groups (name, owner_id) VALUES ('ins-group',$1) RETURNING id`,
    [USER]
  );
  GROUP = g[0].id;
});
afterAll(async () => { await pool.end(); });

describe('ensureInsurance', () => {
  it('seeds a new insurance_pool row with the default balance', async () => {
    const { marketId } = await createExchangeMarket(
      { groupId: GROUP, creatorId: USER, title: 'ins test 1' },
      query
    );
    const balance = await ensureInsurance(marketId, query);
    expect(balance).toBe(INITIAL_INSURANCE);

    const { rows } = await query(
      `SELECT balance FROM insurance_pool WHERE market_id=$1`,
      [marketId]
    );
    expect(rows.length).toBe(1);
    expect(Number(rows[0].balance)).toBe(INITIAL_INSURANCE);
  });

  it('is idempotent: two calls produce one row, balance unchanged', async () => {
    const { marketId } = await createExchangeMarket(
      { groupId: GROUP, creatorId: USER, title: 'ins test 2' },
      query
    );
    const b1 = await ensureInsurance(marketId, query);
    const b2 = await ensureInsurance(marketId, query);
    expect(b1).toBe(INITIAL_INSURANCE);
    expect(b2).toBe(INITIAL_INSURANCE);

    const { rows } = await query(
      `SELECT COUNT(*) AS cnt FROM insurance_pool WHERE market_id=$1`,
      [marketId]
    );
    expect(Number(rows[0].cnt)).toBe(1);
  });
});

describe('createExchangeMarket seeds insurance', () => {
  it('auto-seeds an insurance_pool row on market creation', async () => {
    const { marketId } = await createExchangeMarket(
      { groupId: GROUP, creatorId: USER, title: 'ins create test' },
      query
    );
    const { rows } = await query(
      `SELECT balance FROM insurance_pool WHERE market_id=$1`,
      [marketId]
    );
    expect(rows.length).toBe(1);
    expect(Number(rows[0].balance)).toBe(10000);
  });
});
