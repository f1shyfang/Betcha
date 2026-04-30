const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

function requireSupabaseAdmin() {
  if (!supabaseAdmin) {
    throw new Error('supabase_admin_not_configured');
  }

  return supabaseAdmin;
}

module.exports = { supabaseAdmin, requireSupabaseAdmin };