import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeQuerySpy, makeInflightSpy, uid } from './helpers.js';

const { query, pool } = require('../server/db');
const { getMarketDetail } = require('../server/queries/marketDetail');

const OWNER = uid('md-owner');
const BETTOR = uid('md-bettor');
const OUTSIDER = uid('md-outsider');
let groupId;
let marketId;

beforeAll(async () => {
  await query(
    `INSERT INTO users (id, email, starting_points) VALUES
       ($1,$2,2000), ($3,$4,2000), ($5,$6,2000)
     ON CONFLICT (id) DO NOTHING`,
    [OWNER, `${OWNER}@t.internal`, BETTOR, `${BETTOR}@t.internal`, OUTSIDER, `${OUTSIDER}@t.internal`]
  );
  const { rows: g } = await query(
    `INSERT INTO groups (name, owner_id, is_private) VALUES ('MD Group',$1,true) RETURNING id`,
    [OWNER]
  );
  groupId = g[0].id;
  await query(
    `INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'admin'),($1,$3,'member')`,
    [groupId, OWNER, BETTOR]
  );
  const { rows: m } = await query(
    `INSERT INTO markets (group_id, creator_id, title, state) VALUES ($1,$2,'MD market','open') RETURNING id`,
    [groupId, OWNER]
  );
  marketId = m[0].id;
  // predictions: OWNER yes(100), BETTOR no(50)
  await query(
    `INSERT INTO predictions (market_id, user_id, choice, stake_points) VALUES
       ($1,$2,true,100), ($1,$3,false,50)`,
    [marketId, OWNER, BETTOR]
  );
  // ledger for BETTOR: -50 on this market (stake), and +200 elsewhere (other market noise)
  await query(
    `INSERT INTO ledger_entries (user_id, market_id, delta, reason) VALUES
       ($1,$2,-50,'wager_stake'), ($1,NULL,200,'bonus')`,
    [BETTOR, marketId]
  );
});

afterAll(async () => {
  await query(`DELETE FROM ledger_entries WHERE user_id = ANY($1)`, [[OWNER, BETTOR, OUTSIDER]]);
  await query(`DELETE FROM predictions WHERE market_id = $1`, [marketId]);
  await query(`DELETE FROM markets WHERE id = $1`, [marketId]);
  await query(`DELETE FROM group_members WHERE group_id = $1`, [groupId]);
  await query(`DELETE FROM groups WHERE id = $1`, [groupId]);
  await query(`DELETE FROM users WHERE id = ANY($1)`, [[OWNER, BETTOR, OUTSIDER]]);
  await pool.end();
});

describe('getMarketDetail', () => {
  it('404s for a market that does not exist', async () => {
    const res = await getMarketDetail('00000000-0000-0000-0000-000000000000', OWNER, query);
    expect(res.status).toBe(404);
  });

  it('403s for a non-member', async () => {
    const res = await getMarketDetail(marketId, OUTSIDER, query);
    expect(res.status).toBe(403);
  });

  it('returns correct counts, settlement, prediction and balance for a member', async () => {
    const res = await getMarketDetail(marketId, BETTOR, query);
    expect(res.status).toBe(200);
    const m = res.body.market;
    expect(m.id).toBe(marketId);
    expect(m.prediction_count).toBe(2);
    expect(m.yes_count).toBe(1);
    expect(m.no_count).toBe(1);
    // BETTOR's settlement on THIS market only = -50
    expect(m.my_settlement.total_delta).toBe(-50);
    expect(m.my_settlement.breakdown.wager_stake).toBe(-50);
    // BETTOR's prediction
    expect(m.my_prediction.choice).toBe(false);
    expect(m.my_prediction.stake_points).toBe(50);
    // BETTOR balance = 2000 + (-50 + 200) across ALL markets = 2150
    expect(m.my_balance).toBe(2150);
  });

  it('does not fetch the full user ledger; balance uses a SUM aggregate', async () => {
    const spy = makeQuerySpy();
    await getMarketDetail(marketId, BETTOR, spy);
    // The old full-row fetch is gone.
    expect(spy.matching(/select\s+delta\s+from\s+ledger_entries\s+where\s+user_id/i).length).toBe(0);
    // Balance is aggregated in SQL.
    expect(spy.matching(/sum\s*\(/i).length).toBeGreaterThanOrEqual(1);
    // Counts are aggregated in SQL, not by selecting every choice row.
    expect(spy.matching(/count\s*\(/i).length).toBeGreaterThanOrEqual(1);
    expect(spy.matching(/select\s+choice\s+from\s+predictions\s+where\s+market_id\s*=\s*\$1\s*$/i).length).toBe(0);
  });

  it('runs the independent reads in parallel (max in-flight > 1)', async () => {
    const spy = makeInflightSpy();
    await getMarketDetail(marketId, BETTOR, spy);
    expect(spy.maxInFlight()).toBeGreaterThan(1);
  });
});
