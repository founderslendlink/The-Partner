require('dotenv').config();
const { db } = require('./src/utils/supabase');

async function run() {
  const supabase = db();

  const { data: business, error: businessError } = await supabase
    .from('businesses')
    .select('*')
    .limit(1)
    .single();

  if (businessError) {
    console.error('Business error:', businessError.message);
    return;
  }

  const { data, error } = await supabase
    .from('leads')
    .insert({
      business_id: business.id,
      name: 'John Test',
      email: 'john@test.com',
      phone: '555-555-5555',
      source: 'manual_test',
      status: 'new',
    })
    .select()
    .single();

  if (error) {
    console.error('Lead insert error:', error.message);
    return;
  }

  console.log('Lead created:', data);
}

run();