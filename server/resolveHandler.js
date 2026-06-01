const { query } = require('./db');

// Shared resolve market logic — used by both the Vercel serverless function and tests.
const handleResolve = async (deps) => {
  const { marketId, outcome, method = 'creator', reason = '', idempKey, getIdempotentResponse, storeIdempotentResponse, userId } = deps;

  try {
    const prior = await getIdempotentResponse(idempKey);
    if (prior) return { status: 200, body: prior };

    const { rows: marketRows } = await query(
      'SELECT id, group_id, state, mechanism FROM markets WHERE id = $1 LIMIT 1',
      [marketId]
    );
    const market = marketRows[0];
    if (!market) return { status: 404, body: { error: 'market not found' } };
    if (market.state !== 'open') return { status: 409, body: { error: 'market not open' } };

    const { rows: memberRows } = await query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1',
      [market.group_id, userId]
    );
    if (memberRows.length === 0) return { status: 403, body: { error: 'forbidden' } };

    try {
      if (market.mechanism === 'exchange') {
        await query(
          'SELECT market_resolve_exchange($1, $2, $3, $4, $5)',
          [marketId, userId || null, outcome, method, reason]
        );
      } else {
        await query(
          'SELECT market_resolve_with_ledger($1, $2, $3, $4, $5)',
          [marketId, userId || null, outcome, method, reason]
        );
      }
    } catch (rpcError) {
      // 42883 = undefined_function (migration not applied)
      if (rpcError.code === '42883') {
        return { status: 503, body: { error: 'migration_pending', hint: 'apply 003_market_resolve_rpc.sql' } };
      }
      throw rpcError;
    }

    const { rows: settlementRows } = await query(
      'SELECT user_id, delta, reason FROM ledger_entries WHERE market_id = $1',
      [marketId]
    );

    const myBreakdown = {};
    let myDelta = 0;
    for (const row of settlementRows) {
      if (row.user_id !== userId) continue;
      myBreakdown[row.reason] = (myBreakdown[row.reason] || 0) + (row.delta || 0);
      myDelta += row.delta || 0;
    }

    const response = {
      market_id: marketId,
      outcome,
      my_delta: myDelta,
      my_breakdown: myBreakdown,
    };
    await storeIdempotentResponse(idempKey, response);
    return { status: 200, body: response };
  } catch (e) {
    console.error('Unexpected error', e);
    return { status: 500, body: { error: 'internal' } };
  }
};

module.exports = { handleResolve };
