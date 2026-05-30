import { getUserFromRequest } from '../../../lib/auth';
import { applyCors } from '../../../server/cors';

function buildReply({ message, marketTitle, outcome, evidenceImageUrl }) {
  const direction = outcome === true ? 'YES' : 'NO';
  const trimmed = (message || '').trim();
  const bulletSource = trimmed ? trimmed : `Market "${marketTitle || 'this market'}" resolved ${direction}.`;
  const evidenceLine = evidenceImageUrl ? `Evidence image: ${evidenceImageUrl}` : 'No image evidence attached.';

  return [
    `Suggested resolution note: ${bulletSource}`,
    `Outcome selected: ${direction}.`,
    evidenceLine,
    'Keep the final reason factual and short so group members can audit it quickly.',
  ].join(' ');
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const { message = '', marketTitle = '', outcome = null, evidenceImageUrl = '' } = req.body || {};
    if (outcome !== true && outcome !== false) {
      return res.status(400).json({ error: 'outcome must be true or false' });
    }

    const reply = buildReply({ message, marketTitle, outcome, evidenceImageUrl });
    return res.status(200).json({ reply });
  } catch (e) {
    console.error('support chatbot error', e);
    return res.status(500).json({ error: 'internal' });
  }
}
