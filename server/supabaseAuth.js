const { supabase } = require('./supabaseClient');

async function getUserFromRequest(req) {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader) return null;

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || !parts[1]) return null;

    const token = parts[1];
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;

    return { id: data.user.id, email: data.user.email, raw: data.user };
  } catch (e) {
    console.warn('supabase auth middleware error', e && e.message ? e.message : e);
    return null;
  }
}

module.exports = { getUserFromRequest };
