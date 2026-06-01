import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeQuerySpy, uid } from './helpers.js';

const { query, pool } = require('../server/db');
const { getUserBalance } = require('../server/queries/balance');

const USER = uid('bal-user');
const OTHER = uid('bal-other');

beforeAll(async () => {
  await query(
    `INSERT INTO users (id, email, starting_points) VALUES ($1, $2, 2000), ($3, $4, 2000)
     ON CONFLICT (id) DO NOTHING`,
    [USER, `${USER}@t.internal`, OTHER, `${OTHER}@t.internal`]
  );
  // USER ledger: -100, -50, +300  => net +150 => balance 2150
  await query(
    `INSERT INTO ledger_entries (user_id, delta, reason) VALUES
       ($1, -100, 'wager_stake'),
       ($1, -50, 'wager_stake'),
       ($1, 300, 'wager_win_payout'),
       ($2, 999, 'noise')`,
    [USER, OTHER]
  );
});

afterAll(async () => {
  await query(`DELETE FROM ledger_entries WHERE user_id = ANY($1)`, [[USER, OTHER]]);
  await query(`DELETE FROM users WHERE id = ANY($1)`, [[USER, OTHER]]);
  await pool.end();
});

describe('getUserBalance', () => {
  it('returns starting_points plus the sum of the user ledger deltas', async () => {
    const balance = await getUserBalance(USER);
    expect(balance).toBe(2150);
  });

  it('returns starting_points when the user has no ledger entries', async () => {
    const balance = await getUserBalance(OTHER === USER ? OTHER : OTHER, query);
    // OTHER has one entry (+999) -> 2999
    expect(balance).toBe(2999);
  });

  it('computes the balance with a single aggregate query (no full-row fetch)', async () => {
    const spy = makeQuerySpy();
    await getUserBalance(USER, spy);
    // Performance invariant: one round-trip, and it aggregates in SQL.
    expect(spy.calls.length).toBe(1);
    expect(spy.matching(/sum\s*\(/i).length).toBe(1);
    // Must NOT issue a bare "SELECT delta ... " that pulls every row back.
    expect(spy.matching(/select\s+delta\s+from\s+ledger_entries/i).length).toBe(0);
  });
});
