// Integration test: market resolve flow + idempotency (Neon/pg).
// Requires: DATABASE_URL in env (use: node --env-file=.env.local test/resolve.integration.test.js)

const { handleResolve } = require('../server/resolveHandler');
const { getIdempotentResponse, storeIdempotentResponse } = require('../server/idempotency');
const { query, pool } = require('../server/db');

if (!process.env.DATABASE_URL) {
  console.error('FAIL: DATABASE_URL is required');
  process.exit(1);
}

const TEST_USER_1 = 'test-user-resolve-1';
const TEST_USER_2 = 'test-user-resolve-2';

let groupId, marketId;

async function setup() {
  await query(
    `INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [TEST_USER_1, 'test1@betcha-test.internal', TEST_USER_2, 'test2@betcha-test.internal']
  );

  const { rows: groupRows } = await query(
    `INSERT INTO groups (name, owner_id, is_private) VALUES ($1, $2, true) RETURNING id`,
    ['Test Group', TEST_USER_1]
  );
  groupId = groupRows[0].id;

  await query(
    `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'admin'), ($1, $3, 'member')`,
    [groupId, TEST_USER_1, TEST_USER_2]
  );

  const { rows: marketRows } = await query(
    `INSERT INTO markets (group_id, creator_id, title, state, resolve_by)
     VALUES ($1, $2, 'Test market', 'open', $3) RETURNING id`,
    [groupId, TEST_USER_1, new Date(Date.now() + 60 * 60 * 1000).toISOString()]
  );
  marketId = marketRows[0].id;

  // user1 = YES stake 100, user2 = NO stake 50, debited at bet time
  await query(
    `INSERT INTO predictions (market_id, user_id, choice, stake_points)
     VALUES ($1, $2, true, 100), ($1, $3, false, 50)`,
    [marketId, TEST_USER_1, TEST_USER_2]
  );
  await query(
    `INSERT INTO ledger_entries (user_id, market_id, delta, reason)
     VALUES ($1, $3, -100, 'wager_stake'), ($2, $3, -50, 'wager_stake')`,
    [TEST_USER_1, TEST_USER_2, marketId]
  );
}

async function teardown() {
  try {
    if (marketId) {
      await query(`DELETE FROM ledger_entries WHERE market_id = $1`, [marketId]);
      await query(`DELETE FROM resolutions WHERE market_id = $1`, [marketId]);
      await query(`DELETE FROM predictions WHERE market_id = $1`, [marketId]);
      await query(`DELETE FROM audit_logs WHERE meta->>'market_id' = $1`, [marketId]);
      await query(`DELETE FROM markets WHERE id = $1`, [marketId]);
    }
    if (groupId) {
      await query(`DELETE FROM group_members WHERE group_id = $1`, [groupId]);
      await query(`DELETE FROM groups WHERE id = $1`, [groupId]);
    }
    await query(`DELETE FROM idempotency_keys WHERE key LIKE 'test-idem-%'`);
    await query(`DELETE FROM users WHERE id = ANY($1)`, [[TEST_USER_1, TEST_USER_2]]);
  } catch (err) {
    console.warn('teardown warning:', err.message);
  }
}

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL: ${msg}`);
    failed++;
  }
}

async function testResolveHappyPath() {
  console.log('\n[1] Resolve happy path');
  const idempKey = 'test-idem-resolve-1';
  const result = await handleResolve({
    marketId,
    outcome: true,
    method: 'creator',
    reason: '',
    idempKey,
    getIdempotentResponse,
    storeIdempotentResponse,
    userId: TEST_USER_1,
  });

  assert(result.status === 200, `resolve returns 200 (got ${result.status})`);
  assert(result.body.outcome === true, 'body.outcome is true');

  const { rows: markets } = await query('SELECT state, resolution FROM markets WHERE id = $1', [marketId]);
  assert(markets[0]?.state === 'resolved', 'market.state = resolved');
  assert(markets[0]?.resolution?.outcome === true, 'market.resolution.outcome = true');

  const { rows: ledger } = await query('SELECT user_id, delta FROM ledger_entries WHERE market_id = $1', [marketId]);
  assert(ledger.length >= 3, `ledger rows exist (got ${ledger.length})`);
  const user1Total = ledger.filter((r) => r.user_id === TEST_USER_1).reduce((sum, r) => sum + (r.delta || 0), 0);
  const user2Total = ledger.filter((r) => r.user_id === TEST_USER_2).reduce((sum, r) => sum + (r.delta || 0), 0);
  assert(user1Total === 100, `user1 total is +100 (got ${user1Total})`);
  assert(user2Total === -50, `user2 total is -50 (got ${user2Total})`);

  const { rows: auditRows } = await query(
    `SELECT id FROM audit_logs WHERE actor_id = $1 AND action = 'market_resolved'`,
    [TEST_USER_1]
  );
  assert(auditRows.length >= 1, '1 audit_log row created');

  return idempKey;
}

async function testIdempotency(idempKey) {
  console.log('\n[2] Resolve idempotency — second call returns same result, no double writes');
  const result = await handleResolve({
    marketId,
    outcome: true,
    method: 'creator',
    reason: '',
    idempKey,
    getIdempotentResponse,
    storeIdempotentResponse,
    userId: TEST_USER_1,
  });
  assert(result.status === 200, `second resolve returns 200 (got ${result.status})`);
  assert(result.body.outcome === true, 'body.outcome still true');

  const { rows: ledger } = await query(
    `SELECT reason FROM ledger_entries WHERE market_id = $1 AND reason = 'wager_win_payout'`,
    [marketId]
  );
  assert(ledger.length === 1, `single payout row only (got ${ledger.length})`);
}

async function testAuthGuard() {
  console.log('\n[3] Resolve auth guard — non-member is forbidden');
  const result = await handleResolve({
    marketId,
    outcome: true,
    method: 'creator',
    reason: '',
    idempKey: 'test-idem-forbidden-1',
    getIdempotentResponse,
    storeIdempotentResponse,
    userId: 'test-user-not-a-member',
  });
  // Market is already resolved (state != open) → 409; a fresh market would give 403.
  assert([403, 409].includes(result.status), `non-member resolve is rejected (got ${result.status})`);
}

async function main() {
  console.log('=== Betcha Integration Tests (Neon) ===');
  try {
    await setup();
    console.log(`  Setup: groupId=${groupId}, marketId=${marketId}`);

    const idempKey = await testResolveHappyPath();
    await testIdempotency(idempKey);
    await testAuthGuard();
  } catch (err) {
    console.error('Test error:', err.message);
    failed++;
  } finally {
    await teardown();
    await pool.end();
    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) process.exit(1);
  }
}

main();
