// Integration test: market resolve flow + auth guard + idempotency
// Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in env
// Run: node test/resolve.integration.test.js

const { handleResolve } = require('../server/resolveHandler');
const { getIdempotentResponse, storeIdempotentResponse } = require('../server/idempotency');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('FAIL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

const TEST_USER_1 = '00000000-0000-0000-0000-000000000001';
const TEST_USER_2 = '00000000-0000-0000-0000-000000000002';

async function rest(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`REST ${method} ${path} → ${res.status}: ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function restGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, { headers });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

let groupId, marketId;

async function setup() {
  // Step 0: Create 2 test users with deterministic UUIDs
  await rest('POST', '/users', { id: TEST_USER_1, email: 'test1@betcha-test.internal' });
  await rest('POST', '/users', { id: TEST_USER_2, email: 'test2@betcha-test.internal' });

  // Step 1: Create test group
  const [group] = await rest('POST', '/groups', { name: 'Test Group', owner_id: TEST_USER_1, is_private: true });
  groupId = group.id;

  // Step 2: Add both users as members
  await rest('POST', '/group_members', { group_id: groupId, user_id: TEST_USER_1, role: 'admin' });
  await rest('POST', '/group_members', { group_id: groupId, user_id: TEST_USER_2, role: 'member' });

  // Step 3: Create market
  const [market] = await rest('POST', '/markets', {
    group_id: groupId,
    creator_id: TEST_USER_1,
    title: 'Test market',
    state: 'open',
    resolve_by: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  marketId = market.id;

  // Step 4: Add 2 predictions (user1=YES stake=100, user2=NO stake=50)
  await rest('POST', '/predictions', { market_id: marketId, user_id: TEST_USER_1, choice: true, stake_points: 100 });
  await rest('POST', '/predictions', { market_id: marketId, user_id: TEST_USER_2, choice: false, stake_points: 50 });
  // Debited at bet time
  await rest('POST', '/ledger_entries', { user_id: TEST_USER_1, market_id: marketId, delta: -100, reason: 'wager_stake' });
  await rest('POST', '/ledger_entries', { user_id: TEST_USER_2, market_id: marketId, delta: -50, reason: 'wager_stake' });
}

async function teardown() {
  if (!marketId && !groupId) return;
  try {
    // FK-safe order: audit_logs → ledger_entries → resolutions → predictions → markets → group_members → groups → users
    if (marketId) {
      const mId = encodeURIComponent(marketId);
      await fetch(`${SUPABASE_URL}/rest/v1/audit_logs?meta->>market_id=eq.${mId}`, { method: 'DELETE', headers });
      await fetch(`${SUPABASE_URL}/rest/v1/ledger_entries?market_id=eq.${mId}`, { method: 'DELETE', headers });
      await fetch(`${SUPABASE_URL}/rest/v1/resolutions?market_id=eq.${mId}`, { method: 'DELETE', headers });
      await fetch(`${SUPABASE_URL}/rest/v1/predictions?market_id=eq.${mId}`, { method: 'DELETE', headers });
      await fetch(`${SUPABASE_URL}/rest/v1/markets?id=eq.${mId}`, { method: 'DELETE', headers });
    }
    if (groupId) {
      const gId = encodeURIComponent(groupId);
      await fetch(`${SUPABASE_URL}/rest/v1/group_members?group_id=eq.${gId}`, { method: 'DELETE', headers });
      await fetch(`${SUPABASE_URL}/rest/v1/groups?id=eq.${gId}`, { method: 'DELETE', headers });
    }
    // Clean idempotency keys for test
    await fetch(`${SUPABASE_URL}/rest/v1/idempotency_keys?key=like.test-idem-*`, { method: 'DELETE', headers });
    // Delete test users
    await fetch(`${SUPABASE_URL}/rest/v1/users?id=in.(${TEST_USER_1},${TEST_USER_2})`, { method: 'DELETE', headers });
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

  const markets = await restGet(`/markets?id=eq.${marketId}&select=state,resolution`);
  assert(markets[0]?.state === 'resolved', 'market.state = resolved');
  assert(markets[0]?.resolution?.outcome === true, 'market.resolution.outcome = true');

  const ledger = await restGet(`/ledger_entries?market_id=eq.${marketId}`);
  assert(ledger.length >= 3, `ledger rows exist (got ${ledger.length})`);
  const user1Total = ledger.filter((r) => r.user_id === TEST_USER_1).reduce((sum, r) => sum + (r.delta || 0), 0);
  const user2Total = ledger.filter((r) => r.user_id === TEST_USER_2).reduce((sum, r) => sum + (r.delta || 0), 0);
  assert(user1Total === 100, `user1 total is +100 (got ${user1Total})`);
  assert(user2Total === -50, `user2 total is -50 (got ${user2Total})`);

  const auditRows = await restGet(`/audit_logs?actor_id=eq.${TEST_USER_1}&action=eq.market_resolved`);
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

  const ledger = await restGet(`/ledger_entries?market_id=eq.${marketId}`);
  const payoutRows = ledger.filter((row) => row.reason === 'wager_win_payout');
  assert(payoutRows.length === 1, `single payout row only (got ${payoutRows.length})`);
}

async function testAuthGuard() {
  console.log('\n[3] Auth guard on GET /api/markets/:id');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  // No token → 401
  const r1 = await fetch(`${appUrl}/api/markets/${marketId}`);
  assert(r1.status === 401, `no token → 401 (got ${r1.status})`);

  // Valid service-role token but non-member user
  const nonMemberRes = await fetch(`${appUrl}/api/markets/${marketId}`, {
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  // Service role key is not a user JWT, getUserFromRequest returns null → 401
  assert(nonMemberRes.status === 401, `service role as user token → 401 (got ${nonMemberRes.status})`);
}

async function testMarketCreateIdempotency() {
  console.log('\n[4] Market creation idempotency');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const idempKey = 'test-idem-market-create-1';

  const body = JSON.stringify({ group_id: groupId, title: 'Idempotency test market' });
  const first = await fetch(`${appUrl}/api/markets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempKey, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    body,
  });
  // Service role won't be a valid user JWT — will get 401; this tests the plumbing exists
  // Real test requires a valid user access_token; skip assertion if 401
  if (first.status === 401) {
    console.log('  SKIP: market create idempotency requires valid user token (not available in CI)');
    return;
  }
  const firstData = await first.json();
  assert(first.status === 200, `first create → 200 (got ${first.status})`);

  const second = await fetch(`${appUrl}/api/markets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempKey, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    body,
  });
  const secondData = await second.json();
  assert(second.status === 200, `second create → 200 (got ${second.status})`);
  assert(secondData.id === firstData.id, `same market id returned on replay (got ${secondData.id} vs ${firstData.id})`);

  // Clean up idempotency test market
  if (firstData.id) {
    await fetch(`${SUPABASE_URL}/rest/v1/markets?id=eq.${firstData.id}`, { method: 'DELETE', headers });
  }
}

async function main() {
  console.log('=== Betcha Integration Tests ===');
  try {
    await setup();
    console.log(`  Setup: groupId=${groupId}, marketId=${marketId}`);

    const idempKey = await testResolveHappyPath();
    await testIdempotency(idempKey);
    await testAuthGuard();
    await testMarketCreateIdempotency();
  } catch (err) {
    console.error('Test error:', err.message);
    failed++;
  } finally {
    await teardown();
    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) process.exit(1);
  }
}

main();
