import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeQuerySpy, uid } from './helpers.js';

const { query, pool } = require('../server/db');
const { getLeaderboard } = require('../server/queries/leaderboard');

const A = uid('lb-a');
const B = uid('lb-b');
const C = uid('lb-c');
const OUTSIDER = uid('lb-out');
let groupId;
let marketId;

beforeAll(async () => {
  await query(
    `INSERT INTO users (id, email, display_name, starting_points) VALUES
       ($1,$2,'Alice',2000), ($3,$4,'Bob',2000), ($5,$6,'Cara',2000), ($7,$8,'Eve',2000)
     ON CONFLICT (id) DO NOTHING`,
    [A, `${A}@t.internal`, B, `${B}@t.internal`, C, `${C}@t.internal`, OUTSIDER, `${OUTSIDER}@t.internal`]
  );
  const { rows: g } = await query(
    `INSERT INTO groups (name, owner_id, is_private) VALUES ('LB Group',$1,true) RETURNING id`,
    [A]
  );
  groupId = g[0].id;
  await query(
    `INSERT INTO group_members (group_id, user_id, role) VALUES
       ($1,$2,'admin'),($1,$3,'member'),($1,$4,'member')`,
    [groupId, A, B, C]
  );
  const { rows: m } = await query(
    `INSERT INTO markets (group_id, creator_id, title, state) VALUES ($1,$2,'LB market','resolved') RETURNING id`,
    [groupId, A]
  );
  marketId = m[0].id;
  // A: +300 (older), +100 (newer) => raw 400, trend up. B: -50 => raw -50, trend down. C: none.
  await query(
    `INSERT INTO ledger_entries (user_id, market_id, delta, reason, created_at) VALUES
       ($1,$3,300,'wager_win_payout', now() - interval '2 hours'),
       ($1,$3,100,'bonus',           now() - interval '1 hour'),
       ($2,$3,-50,'wager_stake',      now() - interval '90 minutes')`,
    [A, B, marketId]
  );
});

afterAll(async () => {
  await query(`DELETE FROM ledger_entries WHERE market_id = $1`, [marketId]);
  await query(`DELETE FROM markets WHERE id = $1`, [marketId]);
  await query(`DELETE FROM group_members WHERE group_id = $1`, [groupId]);
  await query(`DELETE FROM groups WHERE id = $1`, [groupId]);
  await query(`DELETE FROM users WHERE id = ANY($1)`, [[A, B, C, OUTSIDER]]);
  await pool.end();
});

describe('getLeaderboard', () => {
  it('403s for a non-member', async () => {
    const res = await getLeaderboard(groupId, OUTSIDER, query);
    expect(res.status).toBe(403);
  });

  it('ranks users by balance with correct raw_delta and trend', async () => {
    const res = await getLeaderboard(groupId, A, query);
    expect(res.status).toBe(200);
    const board = res.body;
    // Only users with ledger activity appear (preserves prior behavior): A and B.
    expect(board.map((r) => r.user_id).sort()).toEqual([A, B].sort());

    const alice = board.find((r) => r.user_id === A);
    const bob = board.find((r) => r.user_id === B);
    expect(alice.raw_delta).toBe(400);
    expect(alice.score).toBe(2400);
    expect(alice.trend).toBe('up');
    expect(alice.last_deltas.length).toBe(2);
    // most recent first
    expect(alice.last_deltas[0].delta).toBe(100);
    expect(bob.raw_delta).toBe(-50);
    expect(bob.score).toBe(1950);
    expect(bob.trend).toBe('down');

    // sorted by score desc
    expect(board[0].user_id).toBe(A);
    expect(board[1].user_id).toBe(B);
  });

  it('aggregates ledger deltas in SQL, not by fetching every row', async () => {
    const spy = makeQuerySpy();
    await getLeaderboard(groupId, A, spy);
    // Aggregation happens in the database.
    expect(spy.matching(/sum\s*\(/i).length).toBeGreaterThanOrEqual(1);
    // The old "pull all ledger rows for the group" query is gone.
    expect(
      spy.matching(/select\s+user_id,\s*market_id,\s*delta,\s*reason,\s*created_at\s+from\s+ledger_entries/i).length
    ).toBe(0);
  });
});
