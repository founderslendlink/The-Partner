const { db } = require('./supabase');
const crypto = require('crypto');

async function writeAuditLog({ businessId, actor, action, entityType, entityId, output, ipAddress }) {
  const supabase = db();
  await supabase.from('audit_logs').insert({
    business_id:  businessId || null,
    actor:        actor || 'system',
    action,
    entity_type:  entityType || null,
    entity_id:    entityId || null,
    input_hash:   crypto.createHash('sha256').update(action + (entityId || '')).digest('hex'),
    output:       output || null,
    ip_address:   ipAddress || null,
    ts:           new Date().toISOString(),
  }).catch(() => {}); // Audit failures are non-fatal
}

module.exports = { writeAuditLog };
