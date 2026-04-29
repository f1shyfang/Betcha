const assert = require('assert');
const { handleResolve } = require('../server/resolveHandler');

function createFakeDb() {
  const state = {
    markets: new Map([['m1', { state: 'open' }]]),
    resolutions: [],
    predictions: [{ user_id: 'u1', choice: true }, { user_id: 'u2', choice: false }],
    ledger: []
  };
  let forcedConflict = false;

  return {
    state,
    forceConflictOnce() {
      forcedConflict = true;
    },
    async query(sql, params) {
      if (sql.startsWith('SELECT state FROM markets')) {
        const market = state.markets.get(params[0]);
        return market ? { rowCount: 1, rows: [{ state: market.state }] } : { rowCount: 0, rows: [] };
      }
      if (sql.startsWith('INSERT INTO resolutions')) {
        if (forcedConflict) {
          forcedConflict = false;
          const err = new Error('duplicate key');
          err.code = '23505';
          throw err;
        }
        const row = { id: 'r1', created_at: new Date().toISOString() };
        state.resolutions.push({ market_id: params[0], outcome: params[2] });
        return { rowCount: 1, rows: [row] };
      }
      if (sql.startsWith('UPDATE markets SET state')) {
        const market = state.markets.get(params[2]);
        if (market) {
          market.state = params[0];
          market.resolution = params[1];
        }
        return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith('SELECT user_id, choice FROM predictions')) {
        return { rowCount: state.predictions.length, rows: state.predictions };
      }
      if (sql.startsWith('INSERT INTO ledger_entries')) {
        state.ledger.push({ user_id: params[0], market_id: params[1], delta: params[2], reason: params[3] });
        return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith('SELECT id, outcome, created_at FROM resolutions')) {
        const row = state.resolutions[0];
        return row ? { rowCount: 1, rows: [{ id: 'r1', outcome: row.outcome, created_at: new Date().toISOString() }] } : { rowCount: 0, rows: [] };
      }
      if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) {
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`Unhandled query: ${sql}`);
    },
    async getClient() {
      return {
        query: this.query.bind(this),
        release() {}
      };
    }
  };
}

function createFakeIdempotency() {
  const cache = new Map();
  return {
    async getIdempotentResponse(key) {
      if (!key) return null;
      return cache.get(key) || null;
    },
    async storeIdempotentResponse(key, response) {
      if (key) cache.set(key, response);
    }
  };
}

async function run() {
  const fakeDb = createFakeDb();
  const fakeIdempotency = createFakeIdempotency();

  const first = await handleResolve({
    marketId: 'm1',
    outcome: true,
    idempKey: 'abc',
    db: fakeDb,
    getIdempotentResponse: fakeIdempotency.getIdempotentResponse,
    storeIdempotentResponse: fakeIdempotency.storeIdempotentResponse
  });
  assert.strictEqual(first.status, 200);
  assert.strictEqual(first.body.market_id, 'm1');
  assert.strictEqual(first.body.outcome, true);
  assert.strictEqual(fakeDb.state.markets.get('m1').state, 'resolved');
  assert.strictEqual(fakeDb.state.ledger.length, 2);

  const second = await handleResolve({
    marketId: 'm1',
    outcome: true,
    idempKey: 'abc',
    db: fakeDb,
    getIdempotentResponse: fakeIdempotency.getIdempotentResponse,
    storeIdempotentResponse: fakeIdempotency.storeIdempotentResponse
  });
  assert.strictEqual(second.status, 200);
  assert.strictEqual(second.body.market_id, 'm1');

  const conflictDb = createFakeDb();
  conflictDb.state.resolutions.push({ market_id: 'm1', outcome: true });
  conflictDb.forceConflictOnce();
  const conflictIdempotency = createFakeIdempotency();

  const conflict = await handleResolve({
    marketId: 'm1',
    outcome: true,
    idempKey: 'xyz',
    db: conflictDb,
    getIdempotentResponse: conflictIdempotency.getIdempotentResponse,
    storeIdempotentResponse: conflictIdempotency.storeIdempotentResponse
  });
  assert.strictEqual(conflict.status, 200);
  assert.strictEqual(conflict.body.market_id, 'm1');
  assert.strictEqual(conflict.body.outcome, true);

  console.log('resolve.e2e.test.js passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
