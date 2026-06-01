import { getUserFromRequest } from '../../../../lib/auth';
import { applyCors } from '../../../../server/cors';
import { getLeaderboard } from '../../../../server/queries/leaderboard';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  const groupId = req.query.id;
  if (!groupId) return res.status(400).json({ error: 'group id is required' });

  try {
    const result = await getLeaderboard(groupId, user.id);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error('leaderboard error', err);
    return res.status(500).json({ error: 'internal server error' });
  }
}
