const { supabase } = require('./supabaseClient');

async function supabaseAuthMiddleware(req, res, next) {
  try {
    const authHeader = req.get('Authorization') || req.get('authorization');
    if (!authHeader) return next();

    const parts = authHeader.split(' ');
    if (parts.length !== 2) return next();

    const token = parts[1];
    if (!token) return next();

    // supabase.auth.getUser accepts an access token as second arg in v2
    const { data, error } = await supabase.auth.getUser(token);
    if (error) {
      // don't block requests on auth failures; just leave req.user undefined
      console.warn('supabase auth getUser error', error.message || error);
      return next();
    }

    if (data && data.user) {
      req.user = { id: data.user.id, email: data.user.email, raw: data.user };
    }
  } catch (e) {
    console.warn('supabase auth middleware error', e && e.message ? e.message : e);
  }
  return next();
}

module.exports = supabaseAuthMiddleware;
