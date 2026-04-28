/**
 * Run this after migration to create your first business:
 *   node scripts/setup.js
 */

require('dotenv').config();
const readline = require('readline');
const { createClient } = require('@supabase/supabase-js');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

async function setup() {
  console.log('\n🚀 The Partner — First-Time Setup\n');
  console.log('This will create your first business and configure default settings.\n');

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const name      = await ask('Business name: ');
  const ownerId   = await ask('Your Telegram user ID (from @userinfobot): ');
  const timezone  = await ask('Timezone (e.g. America/Chicago): ') || 'America/Chicago';

  console.log('\nCreating business...');

  const { data: biz, error: bizErr } = await supabase
    .from('businesses')
    .insert({
      name,
      owner_id: ownerId,
      timezone,
      mode: 'onboarding_mode',
      settings: { setup_complete: false },
    })
    .select()
    .single();

  if (bizErr) {
    console.error('❌ Failed to create business:', bizErr.message);
    rl.close();
    return;
  }

  console.log(`✅ Business created: ${biz.id}`);

  // Insert default permission rules
  console.log('Inserting default permission rules...');
  const { error: permErr } = await supabase.rpc('insert_default_permissions', {
    p_business_id: biz.id
  });

  if (permErr) {
    console.log('⚠️  Permission rules need to be inserted manually.');
    console.log(`   Run in SQL editor: CALL insert_default_permissions('${biz.id}');`);
  } else {
    console.log('✅ Permission rules configured.');
  }

  // Create initial system mode record
  await supabase.from('system_modes').insert({
    business_id: biz.id,
    current_mode: 'onboarding_mode',
  }).catch(() => {});

  // Create onboarding state
  await supabase.from('onboarding_state').insert({
    business_id: biz.id,
    current_phase: 1,
  }).catch(() => {});

  // Register Telegram webhook
  const webhookUrl = await ask('\nYour server URL (e.g. https://yourserver.com): ');
  if (webhookUrl) {
    const axios = require('axios');
    const url = `${webhookUrl.replace(/\/$/, '')}/webhook/telegram`;
    try {
      const resp = await axios.post(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`,
        { url, secret_token: process.env.TELEGRAM_WEBHOOK_SECRET || '' }
      );
      if (resp.data.ok) {
        console.log(`✅ Telegram webhook registered: ${url}`);
      }
    } catch (err) {
      console.log(`⚠️  Could not register webhook: ${err.message}`);
      console.log(`   Register manually: https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook?url=${url}`);
    }
  }

  console.log('\n══════════════════════════════════════════');
  console.log('✅ Setup complete!\n');
  console.log(`Business ID: ${biz.id}`);
  console.log(`Mode: onboarding_mode (will exit after 14 days)\n`);
  console.log('Next steps:');
  console.log('  1. npm start          — Start the server');
  console.log('  2. Send /help         — In Telegram to test the connection');
  console.log('  3. node scripts/seed.js  — Load sample data (optional)');
  console.log('══════════════════════════════════════════\n');

  rl.close();
}

setup().catch(err => {
  console.error('Setup failed:', err.message);
  rl.close();
});
