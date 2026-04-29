function applyCors(req, res) {
  const corsOrigin = process.env.FRONTEND_URL || process.env.VERCEL_URL
    ? (process.env.FRONTEND_URL || `https://${process.env.VERCEL_URL}`)
    : '*';

  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }

  return false;
}

module.exports = { applyCors };
