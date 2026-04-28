/**
 * Seed sample data for testing:
 *   node scripts/seed.js [business-id]
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function seed() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Get first business if ID not provided
  let businessId = process.argv[2];
  if (!businessId) {
    const { data: biz } = await supabase.from('businesses').select('id').limit(1).single();
    businessId = biz?.id;
  }

  if (!businessId) {
    console.error('No business found. Run setup.js first.');
    process.exit(1);
  }

  console.log(`\nSeeding data for business: ${businessId}\n`);

  // Products
  const { data: products } = await supabase.from('products').insert([
    { business_id: businessId, name: 'Starter Plan', description: 'Entry-level service package', price: 997, conversion_rate: 0.12, active: true },
    { business_id: businessId, name: 'Premium Plan', description: 'Full-service package with priority support', price: 2497, conversion_rate: 0.08, active: true },
    { business_id: businessId, name: 'Workshop', description: '2-day intensive workshop', price: 1497, conversion_rate: 0.15, active: true },
  ]).select();
  console.log(`✅ ${products?.length || 0} products created`);

  // Leads
  const { data: leads } = await supabase.from('leads').insert([
    { business_id: businessId, name: 'Sarah Chen', email: 'sarah@example.com', source: 'website_form', status: 'negotiation', lead_score: 78, last_contacted_at: new Date(Date.now() - 5 * 86400000).toISOString() },
    { business_id: businessId, name: 'Marcus Williams', email: 'marcus@example.com', source: 'referral', status: 'new', lead_score: 65, created_at: new Date(Date.now() - 6 * 3600000).toISOString() },
    { business_id: businessId, name: 'Priya Patel', email: 'priya@example.com', phone: '+15125550199', source: 'instagram', status: 'contacted', lead_score: 55 },
    { business_id: businessId, name: 'James Rodriguez', email: 'james@example.com', source: 'referral', status: 'qualified', lead_score: 72 },
    { business_id: businessId, name: 'Alex Kim', email: 'alex@example.com', source: 'cold_outreach', status: 'new', lead_score: 40 },
  ]).select();
  console.log(`✅ ${leads?.length || 0} leads created`);

  // Opportunities
  if (leads && leads.length > 0) {
    const sarahLead = leads.find(l => l.name === 'Sarah Chen');
    const marcusLead = leads.find(l => l.name === 'Marcus Williams');
    const priyaLead = leads.find(l => l.name === 'Priya Patel');

    await supabase.from('opportunities').insert([
      {
        business_id: businessId, lead_id: sarahLead?.id,
        name: 'Sarah Chen — Premium Plan Q3',
        stage: 'negotiation', value: 1800, probability: 0.65,
        stalled_at: new Date(Date.now() - 5 * 86400000).toISOString(), // Stalled 5 days
        close_date: new Date(Date.now() + 10 * 86400000).toISOString().split('T')[0],
        notes: 'Budget revised to $1,800. Decision by the 15th. Waiting on revised proposal.',
      },
      {
        business_id: businessId, lead_id: marcusLead?.id,
        name: 'Marcus Williams — Starter Plan',
        stage: 'proposal', value: 997, probability: 0.3,
        stalled_at: new Date().toISOString(),
      },
      {
        business_id: businessId, lead_id: priyaLead?.id,
        name: 'Priya Patel — Workshop',
        stage: 'prospect', value: 1497, probability: 0.1,
        stalled_at: new Date().toISOString(),
      },
    ]);
    console.log('✅ Opportunities created');
  }

  // Tasks
  await supabase.from('tasks').insert([
    {
      business_id: businessId, title: 'Send revised proposal to Sarah Chen at $1,800',
      status: 'overdue', priority: 9, due_at: new Date(Date.now() - 2 * 86400000).toISOString(),
      related_entity_type: 'lead',
    },
    {
      business_id: businessId, title: 'Follow up with Marcus Williams on Starter Plan proposal',
      status: 'pending', priority: 7, due_at: new Date(Date.now() + 1 * 86400000).toISOString(),
    },
    {
      business_id: businessId, title: 'Prepare Q3 pipeline review',
      status: 'pending', priority: 5, due_at: new Date(Date.now() + 3 * 86400000).toISOString(),
    },
  ]);
  console.log('✅ Tasks created');

  // Memory entries
  await supabase.from('memory_entries').insert([
    { business_id: businessId, type: 'preference', content: 'Sarah Chen prefers email over SMS and responds best on Tuesday mornings. Budget revised from $2,400 to $1,800 — price sensitivity noted.', importance: 9, source: 'operator' },
    { business_id: businessId, type: 'insight', content: 'Referral leads from existing clients have 2x higher close rate than cold outreach.', importance: 7, source: 'system' },
    { business_id: businessId, type: 'pattern', content: 'Leads that engage with the website contact form after 9pm show higher urgency and convert faster.', importance: 6, source: 'system' },
  ]);
  console.log('✅ Memory entries created');

  console.log('\n✅ Sample data seeded successfully!\n');
  console.log('Try these Telegram commands to test:');
  console.log('  /status    — See your pipeline');
  console.log('  /pipeline  — View all deals');
  console.log('  /briefing  — Get a morning briefing');
}

seed().catch(console.error);
