// Cancels a resting (open/partial) order. Escrow is released implicitly: the
// availableCash formula only counts open/partial buy orders, so flipping status
// to 'cancelled' frees the locked premium. Runs under the per-market advisory
// lock to stay consistent with the executor.
async function cancelOrder({ orderId, userId }, deps) {
  const client = await deps.getClient();
  const q = (text, params) => client.query(text, params);
  try {
    await q('BEGIN');
    const { rows } = await q(`SELECT market_id, user_id, status FROM orders WHERE id=$1`, [orderId]);
    if (rows.length === 0) { await q('ROLLBACK'); return { status: 'error', error: 'not_found' }; }
    const order = rows[0];
    if (order.user_id !== userId) { await q('ROLLBACK'); return { status: 'error', error: 'forbidden' }; }
    await q('SELECT pg_advisory_xact_lock(hashtext($1))', [order.market_id]);
    if (!['open', 'partial'].includes(order.status)) { await q('ROLLBACK'); return { status: 'error', error: 'not_cancellable' }; }
    await q(`UPDATE orders SET status='cancelled' WHERE id=$1`, [orderId]);
    await q('COMMIT');
    return { status: 'ok' };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { cancelOrder };
