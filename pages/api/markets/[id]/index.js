import { applyCors } from '../../../../server/cors';
import { query } from '../../../../server/db';
import { getUserFromRequest } from '../../../../lib/auth';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  const marketId = req.query.id;

  try {
    const { rows: marketRows } = await query(
      `SELECT id, group_id, creator_id, title, type, state, resolve_by, resolution, created_at
       FROM markets WHERE id = $1 LIMIT 1`,
      [marketId]
    );
    const market = marketRows[0];
    if (!market) {
      return res.status(404).json({ error: 'market not found' });
    }

    const { rows: memberRows } = await query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1',
      [market.group_id, user.id]
    );
    if (memberRows.length === 0) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const { rows: predictionRows } = await query(
      'SELECT choice FROM predictions WHERE market_id = $1',
      [marketId]
    );

    const { rows: mySettlementRows } = await query(
      'SELECT delta, reason, created_at FROM ledger_entries WHERE market_id = $1 AND user_id = $2',
      [marketId, user.id]
    );

    const { rows: myPredictionRows } = await query(
      'SELECT stake_points, choice, created_at FROM predictions WHERE market_id = $1 AND user_id = $2 LIMIT 1',
      [marketId, user.id]
    );
    const myPredictionRow = myPredictionRows[0] || null;

    const { rows: userRows } = await query(
      'SELECT starting_points FROM users WHERE id = $1 LIMIT 1',
      [user.id]
    );
    const userRow = userRows[0];

    const { rows: allLedgerRows } = await query(
      'SELECT delta FROM ledger_entries WHERE user_id = $1',
      [user.id]
    );

    const predictionCount = predictionRows.length;
    const yesCount = predictionRows.filter((row) => row.choice === true).length;
    const noCount = predictionRows.filter((row) => row.choice === false).length;

    const settlementBreakdown = {};
    let settlementDelta = 0;
    for (const row of mySettlementRows) {
      settlementBreakdown[row.reason] = (settlementBreakdown[row.reason] || 0) + (row.delta || 0);
      settlementDelta += row.delta || 0;
    }
    const userBalance = (userRow?.starting_points ?? 2000) + allLedgerRows.reduce((sum, row) => sum + (row.delta || 0), 0);

    return res.status(200).json({
      market: {
        ...market,
        prediction_count: predictionCount,
        yes_count: yesCount,
        no_count: noCount,
        my_settlement: {
          total_delta: settlementDelta,
          breakdown: settlementBreakdown,
        },
        my_prediction: myPredictionRow,
        my_balance: userBalance,
      },
    });
  } catch (e) {
    console.error('market detail error', e);
    return res.status(500).json({ error: 'internal' });
  }
}
