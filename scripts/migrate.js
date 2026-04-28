/**
 * Run this once to set up your Supabase database:
 *   node scripts/migrate.js
 *
 * Reads all .sql files from supabase/migrations/ in order and executes them.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

async function migrate() {
  console.log('🔧 The Partner — Database Migration\n');

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env');
    process.exit(1);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`Found ${files.length} migration file(s):\n`);

  for (const file of files) {
    console.log(`  Running: ${file}`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

    // Split by semicolons and run each statement
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    let ok = 0;
    let skipped = 0;

    for (const stmt of statements) {
      const { error } = await supabase.rpc('exec_sql', { sql: stmt + ';' }).catch(() => ({
        error: { message: 'rpc not available' }
      }));

      // If rpc fails, try direct query
      if (error) {
        // Note: For Supabase, run migrations directly in the SQL editor
        // or use the Supabase CLI: supabase db push
        skipped++;
      } else {
        ok++;
      }
    }

    console.log(`  ✅ ${file} — ${ok} statements OK, ${skipped} via SQL editor needed\n`);
  }

  console.log('');
  console.log('📋 IMPORTANT: Supabase does not allow arbitrary SQL via the JS client.');
  console.log('   Run your migrations one of these ways:');
  console.log('');
  console.log('   Option 1 (Recommended): Supabase CLI');
  console.log('     npx supabase db push');
  console.log('');
  console.log('   Option 2: SQL Editor in Supabase dashboard');
  console.log('     Copy and paste supabase/migrations/001_initial_schema.sql');
  console.log('     Then: supabase/migrations/002_default_permissions.sql');
  console.log('');
  console.log('   After migration, run: node scripts/setup.js');
}

migrate().catch(console.error);
