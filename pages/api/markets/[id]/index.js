const db = require('../../../../server/db');
const { applyCors } = require('../../../../server/cors');
const { getUserFromRequest } = require('../../../../server/supabaseAuth');

async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const marketId = req.query.id;

  try {
    const result = await db.query(
      `SELECT m.id, m.group_id, m.creator_id, m.title, m.type, m.state,
              m.resolve_by, m.resolution, m.created_at,
              (SELECT count(*) FROM predictions WHERE market_id = m.id)::int as prediction_count,
              (SELECT count(*) FILTER (WHERE choice = true) FROM predictions WHERE market_id = m.id)::int as yes_count,
              (SELECT count(*) FILTER (WHERE choice = false) FROM predictions WHERE market_id = m.id)::int as no_count
       FROM markets m
       WHERE m.id = $1`,
      [marketId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'market not found' });
    }

    return res.status(200).json({ market: result.rows[0] });
  } catch (e) {
    console.error('market detail error', e);
    return res.status(500).json({ error: 'internal' });
  }
}

module.exports = handler;
module.exports.default = handler;
