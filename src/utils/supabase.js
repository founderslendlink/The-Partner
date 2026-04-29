require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

let client = null;

function initSupabase() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      throw new Error(
        `Missing Supabase credentials.\n` +
        `SUPABASE_URL: ${url ? 'set' : 'MISSING'}\n` +
        `SUPABASE_SERVICE_ROLE_KEY: ${key ? 'set' : 'MISSING'}`
      );
    }

    client = createClient(url, key, {
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
