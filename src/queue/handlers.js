/**
 * Action Handlers Registry
 *
 * Each handler receives (payload, businessId) and returns a result object.
 * Register new action types here.
 */

const { db } = require('../utils/supabase');
const { logger } = require('../utils/logger');
const { sendTelegramMessage, sendTelegramAlert } = require('../telegram/sender');
const { postToDiscord } = require('../discord/poster');

// ── Lead Actions ──────────────────────────────────────────────────────────────

async function handle_create_lead(payload, businessId) {
  const supabase = db();
  const { data, error } = await supabase
    .from('leads')
    .insert({
      business_id: businessId,
      name:        payload.name,
      email:       payload.email || null,
      phone:       payload.phone || null,
      source:      payload.source || 'manual',
      status:      'new',
      metadata:    payload.metadata || {},
    })
    .select()
    .single();

  if (error) throw error;

  // Emit event
  await supabase.from('events').insert({
    business_id: businessId,
    type: 'lead.created',
    entity_type: 'lead',
    entity_id: data.id,
    payload: { name: data.name, source: data.source },
  });

  return { lead_id: data.id, name: data.name };
}

async function handle_update_lead_score(payload, businessId) {
  const supabase = db();
  const { error } = await supabase
    .from('leads')
    .update({ lead_score: payload.score, updated_at: new Date().toISOString() })
    .eq('id', payload.lead_id)
    .eq('business_id', businessId);
  if (error) throw error;
  return { lead_id: payload.lead_id, score: payload.score };
}

async function handle_flag_stalled_deal(payload, businessId) {
  const supabase = db();
  const { data: opp } = await supabase
    .from('opportunities')
    .select('name,stage,value,leads(name)')
    .eq('id', payload.opportunity_id)
    .single();

  await postToDiscord(businessId, 'alerts',
    `🚨 **Stalled Deal**: ${opp?.name}\n` +
    `Stage: ${opp?.stage} | Value: $${opp?.value}\n` +
    `Lead: ${opp?.leads?.name || 'unknown'}\n` +
    `Days stalled: ${payload.days_stalled || '?'}`
  );

  return { flagged: true, opportunity_id: payload.opportunity_id };
}

async function handle_advance_opp_stage(payload, businessId) {
  const supabase = db();
  const { data, error } = await supabase
    .from('opportunities')
    .update({
      stage: payload.new_stage,
      stalled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', payload.opportunity_id)
    .eq('business_id', businessId)
    .select()
    .single();

  if (error) throw error;

  await supabase.from('events').insert({
    business_id: businessId,
    type: 'opportunity.stage_changed',
    entity_type: 'opportunity',
    entity_id: data.id,
    payload: { from: payload.from_stage, to: payload.new_stage },
  });

  await postToDiscord(businessId, 'pipeline',
    `📈 **Deal advanced**: ${data.name}\n` +
    `${payload.from_stage} → ${payload.new_stage} | $${data.value}`
  );

  return { opportunity_id: data.id, new_stage: data.stage };
}

// ── Task Actions ──────────────────────────────────────────────────────────────

async function handle_create_task(payload, businessId) {
  const supabase = db();
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      business_id:          businessId,
      title:                payload.title,
      assigned_agent:       payload.assigned_agent || 'operations_memory',
      status:               'pending',
      priority:             payload.priority || 5,
      due_at:               payload.due_at || null,
      related_entity_type:  payload.related_entity_type || null,
      related_entity_id:    payload.related_entity_id || null,
      context:              payload.context || {},
    })
    .select()
    .single();

  if (error) throw error;
  return { task_id: data.id, title: data.title };
}

async function handle_mark_task_overdue(payload, businessId) {
  const supabase = db();
  await supabase
    .from('tasks')
    .update({ status: 'overdue', updated_at: new Date().toISOString() })
    .eq('id', payload.task_id)
    .eq('business_id', businessId);
  return { task_id: payload.task_id, status: 'overdue' };
}

async function handle_reschedule_task(payload, businessId) {
  const supabase = db();
  const { error } = await supabase
    .from('tasks')
    .update({ due_at: payload.new_due_at, updated_at: new Date().toISOString() })
    .eq('id', payload.task_id)
    .eq('business_id', businessId);
  if (error) throw error;
  return { task_id: payload.task_id, new_due_at: payload.new_due_at };
}

// ── Communication Actions ─────────────────────────────────────────────────────

async function handle_draft_message(payload, businessId) {
  // Stores draft in the action queue result — no external send
  // The draft is accessible for review via /approvals
  const supabase = db();
  await supabase.from('interactions').insert({
    business_id: businessId,
    lead_id:     payload.lead_id || null,
    channel:     payload.channel || 'telegram',
    direction:   'outbound',
    content:     `[DRAFT] ${payload.message}`,
    metadata:    { draft: true, draft_for: payload.purpose || 'follow_up' },
  });
  return { draft: payload.message, lead_id: payload.lead_id };
}

async function handle_send_message(payload, businessId) {
  // Log the interaction
  const supabase = db();
  await supabase.from('interactions').insert({
    business_id: businessId,
    lead_id:     payload.lead_id || null,
    channel:     payload.channel || 'other',
    direction:   'outbound',
    content:     payload.message,
    metadata:    payload.metadata || {},
  });

  // Update last_contacted_at
  if (payload.lead_id) {
    await supabase
      .from('leads')
      .update({ last_contacted_at: new Date().toISOString() })
      .eq('id', payload.lead_id);
  }

  // In a real deployment, this would call your SMS/email API
  logger.info(`[SEND_MESSAGE] Channel: ${payload.channel} | Lead: ${payload.lead_id}`);
  logger.info(`[SEND_MESSAGE] Content: ${payload.message}`);

  return { sent: true, channel: payload.channel, lead_id: payload.lead_id };
}

// ── Memory Actions ────────────────────────────────────────────────────────────

async function handle_write_memory(payload, businessId) {
  const { writeMemory } = require('../memory/manager');
  const entry = await writeMemory(businessId, {
    type:       payload.type || 'note',
    content:    payload.content,
    importance: payload.importance || 5,
    source:     payload.source || 'action_queue',
    tags:       payload.tags || [],
    entityType: payload.entity_type,
    entityId:   payload.entity_id,
  });
  return { memory_id: entry?.id };
}

// ── Notification Actions ──────────────────────────────────────────────────────

async function handle_post_discord_alert(payload, businessId) {
  await postToDiscord(businessId, payload.channel || 'alerts', payload.message);
  return { posted: true };
}

async function handle_send_telegram_notif(payload, businessId) {
  await sendTelegramAlert(businessId, payload.message);
  return { sent: true };
}

async function handle_update_metrics(payload, businessId) {
  const supabase = db();
  const entries = Object.entries(payload.metrics || {}).map(([key, value]) => ({
    business_id:  businessId,
    metric_key:   key,
    value:        parseFloat(value),
    period:       payload.period || 'daily',
    period_start: payload.period_start || new Date().toISOString(),
  }));

  if (entries.length > 0) {
    await supabase.from('metrics').insert(entries);
  }
  return { updated: entries.length };
}

// ── Registry ──────────────────────────────────────────────────────────────────

const handlers = {
  create_lead:          handle_create_lead,
  update_lead_score:    handle_update_lead_score,
  flag_stalled_deal:    handle_flag_stalled_deal,
  advance_opp_stage:    handle_advance_opp_stage,
  create_task:          handle_create_task,
  mark_task_overdue:    handle_mark_task_overdue,
  reschedule_task:      handle_reschedule_task,
  draft_message:        handle_draft_message,
  send_message:         handle_send_message,
  write_memory:         handle_write_memory,
  post_discord_alert:   handle_post_discord_alert,
  send_telegram_notif:  handle_send_telegram_notif,
  update_metrics:       handle_update_metrics,
};

module.exports = handlers;
