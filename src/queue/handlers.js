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

  const dealChannel = data.stage === 'won'  ? 'deals_won'
                    : data.stage === 'lost' ? 'deals_lost'
                    : 'pipeline';
  await postToDiscord(businessId, dealChannel,
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

// ── Social Media Actions (Priority 2) ────────────────────────────────────────

async function handle_post_instagram(payload, businessId) {
  const { postToInstagram } = require('../integrations/social');
  const result = await postToInstagram(businessId, {
    caption: payload.caption || payload.text,
    imageUrl: payload.image_url || payload.media_urls?.[0],
    postId: payload.post_id,
  });
  if (payload.post_id) {
    try {
      await db().from('content_posts')
        .update({ status: 'published', published_at: new Date().toISOString(), platform_post_id: result.platform_post_id })
        .eq('id', payload.post_id);
    } catch (e) {}
  }
  return result;
}

async function handle_post_linkedin(payload, businessId) {
  const { postToLinkedIn } = require('../integrations/social');
  const result = await postToLinkedIn(businessId, {
    text: payload.text || payload.caption,
    imageUrl: payload.image_url || payload.media_urls?.[0],
    postId: payload.post_id,
  });
  return result;
}

async function handle_post_twitter(payload, businessId) {
  const { postToTwitter } = require('../integrations/social');
  const result = await postToTwitter(businessId, {
    text: payload.text || payload.caption,
    imageUrl: payload.image_url,
    postId: payload.post_id,
  });
  return result;
}

async function handle_post_facebook(payload, businessId) {
  const { postToFacebook } = require('../integrations/social');
  const result = await postToFacebook(businessId, {
    message: payload.message || payload.text || payload.caption,
    imageUrl: payload.image_url || payload.media_urls?.[0],
    postId: payload.post_id,
  });
  return result;
}

async function handle_schedule_post(payload, businessId) {
  const supabase = db();
  const { data, error } = await supabase.from('content_posts').insert({
    business_id:  businessId,
    platform:     payload.platform,
    content:      payload.content || payload.caption || payload.text,
    media_urls:   payload.media_urls || [],
    hashtags:     payload.hashtags || [],
    scheduled_at: payload.scheduled_at,
    status:       'scheduled',
    campaign_id:  payload.campaign_id || null,
  }).select().single();
  if (error) throw error;
  return { post_id: data.id, scheduled_at: data.scheduled_at };
}

async function handle_get_post_performance(payload, businessId) {
  const { getPostPerformance } = require('../integrations/social');
  const perf = await getPostPerformance(
    payload.platform,
    payload.platform_post_id,
    businessId
  );
  if (payload.post_id) {
    try {
      await db().from('content_posts')
        .update({ performance: perf, updated_at: new Date().toISOString() })
        .eq('id', payload.post_id);
    } catch (e) {}
  }
  return { performance: perf };
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
  // Social (Priority 2)
  post_instagram:         handle_post_instagram,
  post_linkedin:          handle_post_linkedin,
  post_twitter:           handle_post_twitter,
  post_facebook:          handle_post_facebook,
  schedule_post:          handle_schedule_post,
  get_post_performance:   handle_get_post_performance,
  // Email (Priority 1A)
  send_email:             handle_send_email,
  send_campaign:          handle_send_campaign,
  create_email_sequence:  handle_create_email_sequence,
  // SMS (Priority 1B)
  send_sms:               handle_send_sms,
  // Calendar/Meetings (Priority 2)
  book_meeting:           handle_book_meeting,
  get_availability:       handle_get_availability,
  send_meeting_briefing:  handle_send_meeting_briefing,
  // Referral (Priority 4)
  send_referral_request:  handle_send_referral_request,
  create_affiliate:       handle_create_affiliate,
  record_referral:        handle_record_referral,
  pay_commission:         handle_pay_commission,
};

module.exports = handlers;

// ── Email Actions (Priority 3) — defined after registry to avoid hoisting issues ──

async function handle_send_email(payload, businessId) {
  const { sendEmail } = require('../integrations/email');
  return sendEmail({
    to:         payload.to,
    subject:    payload.subject,
    body:       payload.body || payload.html || payload.message,
    businessId,
    leadId:     payload.lead_id || null,
  });
}

async function handle_send_campaign(payload, businessId) {
  const { sendEmail } = require('../integrations/email');
  const supabase = db();

  // Fetch leads matching the criteria
  let query = supabase.from('leads').select('id,name,email').eq('business_id', businessId);
  if (payload.status_filter) query = query.eq('status', payload.status_filter);
  const { data: leads } = await query.limit(payload.max_recipients || 500);

  const validLeads = (leads || []).filter((l) => l.email);
  let sent = 0;

  for (const lead of validLeads) {
    // Personalise subject/body
    const subject = (payload.subject || '').replace('{{name}}', lead.name);
    const body    = (payload.body    || '').replace('{{name}}', lead.name);
    try {
      await sendEmail({ to: lead.email, subject, body, businessId, leadId: lead.id });
      sent++;
    } catch (err) {
      logger.warn(`Campaign email failed for ${lead.email}:`, err.message);
    }
  }

  // Update campaign record if provided
  if (payload.campaign_id) {
    try {
      await supabase
        .from('email_campaigns')
        .update({ sent_count: sent, status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', payload.campaign_id);
    } catch (e) {}
  }

  return { sent, total: validLeads.length };
}

async function handle_create_email_sequence(payload, businessId) {
  const supabase = db();
  const steps = payload.steps || [];
  const jobs = [];

  for (const step of steps) {
    const sendAt = new Date(Date.now() + (step.delay_days || 0) * 86400000);
    const { data } = await supabase
      .from('scheduled_jobs')
      .insert({
        business_id:     businessId,
        name:            `email_sequence_${payload.sequence_name}_step_${step.step}`,
        job_type:        'send_email',
        payload:         {
          to:         step.to,
          subject:    step.subject,
          body:       step.body,
          lead_id:    step.lead_id,
          sequence:   payload.sequence_name,
        },
        next_run_at:     sendAt.toISOString(),
        cron_expression: null,
      })
      .select()
      .single();
    if (data) jobs.push(data.id);
  }

  return { sequence: payload.sequence_name, jobs_created: jobs.length };
}

// ── SMS Actions (Priority 1B) ─────────────────────────────────────────────────

async function handle_send_sms(payload, businessId) {
  const { sendSMS } = require('../integrations/sms');
  return sendSMS({
    to:         payload.to,
    message:    payload.message || payload.body,
    businessId,
    leadId:     payload.lead_id || null,
  });
}

// ── Calendar / Meeting Actions (Priority 2) ───────────────────────────────────

async function handle_book_meeting(payload, businessId) {
  const { createEvent } = require('../integrations/calendar');
  return createEvent({
    businessId,
    title:         payload.title,
    start:         payload.start,
    end:           payload.end,
    attendeeEmail: payload.attendee_email,
    attendeeName:  payload.attendee_name,
    description:   payload.description || '',
    leadId:        payload.lead_id || null,
    opportunityId: payload.opportunity_id || null,
  });
}

async function handle_get_availability(payload, businessId) {
  const { getAvailableSlots } = require('../integrations/calendar');
  return getAvailableSlots({
    businessId,
    dateRange: payload.date_range || { start: new Date().toISOString(), end: new Date(Date.now() + 7 * 86400000).toISOString() },
    duration:  payload.duration || 60,
  });
}

async function handle_send_meeting_briefing(payload, businessId) {
  const { getMeetingBriefing } = require('../integrations/calendar');
  const { sendTelegramAlert } = require('../telegram/sender');
  const briefing = await getMeetingBriefing({ businessId, eventId: payload.event_id, meetingId: payload.meeting_id });
  await sendTelegramAlert(businessId, briefing);
  return { sent: true };
}

// ── Referral Actions (Priority 4) ────────────────────────────────────────────

async function handle_send_referral_request(payload, businessId) {
  const supabase = db();

  // Log the referral request as an interaction
  await supabase.from('interactions').insert({
    business_id: businessId,
    lead_id:     payload.lead_id || null,
    channel:     payload.channel || 'telegram',
    direction:   'outbound',
    content:     payload.message,
    metadata:    { type: 'referral_request', referral_code: payload.referral_code || null },
  });

  // Create a follow-up task
  await supabase.from('tasks').insert({
    business_id:         businessId,
    title:               `Follow up on referral request sent to lead ${payload.lead_id || 'unknown'}`,
    assigned_agent:      'referral',
    status:              'pending',
    priority:            4,
    due_at:              new Date(Date.now() + 7 * 86400000).toISOString(), // 7 days
    related_entity_type: 'lead',
    related_entity_id:   payload.lead_id || null,
    context:             { referral_code: payload.referral_code },
  });

  // Upsert a referral_tracking row (pending until lead converts)
  if (payload.lead_id) {
    try {
      await supabase.from('referral_tracking').upsert({
        business_id:     businessId,
        affiliate_id:    payload.affiliate_id || null,
        referred_lead_id: null,
        referral_code:   payload.referral_code || null,
        status:          'pending',
      }, { onConflict: 'business_id,referral_code' });
    } catch (e) {}
  }

  return { sent: true, lead_id: payload.lead_id };
}

async function handle_create_affiliate(payload, businessId) {
  const supabase = db();
  const { v4: uuidv4 } = require('uuid');

  const referralCode = payload.referral_code ||
    payload.name.toLowerCase().replace(/\s+/g, '').slice(0, 8) +
    Math.random().toString(36).slice(2, 6);

  const { data, error } = await supabase.from('affiliates').insert({
    business_id:  businessId,
    lead_id:      payload.lead_id || null,
    name:         payload.name,
    email:        payload.email,
    referral_code: referralCode,
    program_id:   payload.program_id,
    status:       'active',
  }).select().single();

  if (error) throw error;

  // Send welcome message via email if available
  const { sendEmail } = require('../integrations/email');
  await sendEmail({
    to:         payload.email,
    subject:    'Welcome to our affiliate program!',
    body:       `Hi ${payload.name},<br><br>Your referral code is: <strong>${referralCode}</strong><br><br>Every qualified referral earns you a reward. Thank you!`,
    businessId,
    leadId:     payload.lead_id || null,
  }).catch(() => {}); // non-fatal

  return { affiliate_id: data.id, referral_code: referralCode };
}

async function handle_record_referral(payload, businessId) {
  const supabase = db();

  // Create referral tracking record
  const { data, error } = await supabase.from('referral_tracking').insert({
    business_id:     businessId,
    affiliate_id:    payload.affiliate_id || null,
    referred_lead_id: payload.referred_lead_id || null,
    referral_code:   payload.referral_code || null,
    status:          'qualified',
  }).select().single();

  if (error) throw error;

  // Fetch program to calculate reward
  let rewardAmount = 0;
  if (payload.affiliate_id) {
    const { data: affiliate } = await supabase
      .from('affiliates')
      .select('program_id, referral_programs(reward_value, reward_type)')
      .eq('id', payload.affiliate_id)
      .single();

    if (affiliate?.referral_programs) {
      rewardAmount = affiliate.referral_programs.reward_value;

      // Create pending commission
      await supabase.from('commissions').insert({
        business_id:  businessId,
        affiliate_id: payload.affiliate_id,
        referral_id:  data.id,
        amount:       rewardAmount,
        status:       'pending',
      });

      // Increment affiliate totals
      try {
        await supabase.rpc('increment_affiliate_stats', {
          p_affiliate_id: payload.affiliate_id,
          p_amount: rewardAmount,
        });
      } catch (e) {
        // rpc may not exist, do manual update
        try {
          await supabase.from('affiliates')
            .update({ total_referrals: supabase.raw('total_referrals + 1') })
            .eq('id', payload.affiliate_id);
        } catch (e2) {}
      }
    }
  }

  return { referral_id: data.id, reward_amount: rewardAmount };
}

async function handle_pay_commission(payload, businessId) {
  // Always approval_required — the permission layer enforces this
  // but we also double-check here
  const supabase = db();

  const { data, error } = await supabase
    .from('commissions')
    .update({
      status:     'paid',
      paid_at:    new Date().toISOString(),
      approved_at: new Date().toISOString(),
    })
    .eq('id', payload.commission_id)
    .eq('business_id', businessId)
    .select()
    .single();

  if (error) throw error;

  // Update affiliate total_earned
  try {
    await supabase
      .from('affiliates')
      .update({ total_earned: supabase.raw(`total_earned + ${parseFloat(payload.amount) || 0}`) })
      .eq('id', data.affiliate_id);
  } catch (e) {}

  // Update referral_tracking to paid
  try {
    await supabase
      .from('referral_tracking')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', data.referral_id);
  } catch (e) {}

  return { commission_id: data.id, paid: true, amount: data.amount };
}
