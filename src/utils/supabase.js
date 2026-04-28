const { createClient } = require('@supabase/supabase-js');

let client = null;

function initSupabase() {
  if (!client) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env'
      );
    }

    client = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    console.log('✅ Supabase client initialized');
  }

  return client;
}

function db() {
  return initSupabase();
}

module.exports = { initSupabase, db };