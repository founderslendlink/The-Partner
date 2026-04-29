const cron = require('node-cron');
const { db } = require('../utils/supabase');
const { logger } = require('../utils/logger');
const { runSalesAgent } = require('../agents/sales');
const { buildContext } = require('../context/builder');
const { enqueue } = require('../queue/enqueue');
const { sendTelegramAlert } = require('../telegram/sender');
const { postToDiscord } = require('../discord/poster');

const STALL_HOURS      = parseInt(process.env.STALL_THRESHOLD_HOURS || '72');
const HOT_THRESHOLD    = parseInt(process.env.HOT_LEAD_CONTACT_THRESHOLD_MINUTES || '30');
const WARM_THRESHOLD   = parseInt(process.env.WARM_LEAD_CONTACT_THRESHOLD_MINUTES || '240');
const COOLDOWN_HOURS   = parseInt(process.env.ALERT_COOLDOWN_HOURS || '4');

function startHeartbeat() {
  // Every 5 minutes — urgent checks
  cron.schedule(process.env.HEARTBEAT_URGENT_CRON || '*/5 * * * *', async () => {
    await runForAllBusinesses(runUrgentChecks, 'urgent');
  });

  // Every hour — pipeline health
  cron.schedule(process.env.HEARTBEAT_HOURLY_CRON || '0 * * * *', async () => {
    await runForAllBusinesses(runPipelineChecks, 'pipeline');
  });

  // Daily — strategy analysis
  cron.schedule(process.env.HEARTBEAT_DAILY_CRON || '0 8 * * *', async () => {
    await runForAllBusinesses(runStrategyChecks, 'strategy');
  });

  logger.info('Heartbeat scheduler initialized (5min / hourly / daily)');
}

async function runForAllBusinesses(checkFn, checkType) {
  const supabase = db();
  const { data: businesses } = await supabase
    .from('businesses')
    .select('id,name,mode')
    .eq('active', true);

  if (!businesses) return;

  for (const biz of businesses) {
    if (biz.mode === 'admin_mode') continue; // Skip in admin mode
    try {
      await checkFn(biz.id, biz.name);
    } catch (err) {
      logger.error(`Heartbeat ${checkType} failed for ${biz.name}:`, err.message);
    }
  }
}

// ── Urgent Checks (every 5 min) ───────────────────────────────────────────────

async function runUrgentChecks(businessId, bizName) {
  const supabase = db();

  // Check 1: Uncontacted inbound leads
  const hotCutoff  = new Date(Date.now() - HOT_THRESHOLD * 60 * 1000).toISOString();
  const warmCutoff = new Date(Date.now() - WARM_THRESHOLD * 60 * 1000).toISOString();

  const { data: uncontacted } = await supabase
    .from('leads')
    .select('id,name,status,lead_score,last_contacted_at,created_at,source')
    .eq('business_id', businessId)
    .in('status', ['new', 'contacted'])
    .or(
      `and(lead_score.gte.70,last_contacted_at.lte.${hotCutoff}),` +
      `and(lead_score.lt.70,lead_score.gte.40,last_contacted_at.lte.${warmCutoff}),` +
      `and(last_contacted_at.is.null,created_at.lte.${warmCutoff})`
    );

  for (const lead of (uncontacted || [])) {
    await fireLeadAlert(businessId, lead, 'uncontacted');
  }

  // Check 2: Approval queue aging (>2 hours)
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: agingApprovals } = await supabase
    .from('action_queue')
    .select('id,action_type,created_at')
    .eq('business_id', businessId)
    .eq('status', 'approval_required')
    .lt('created_at', twoHoursAgo);

  if (agingApprovals && agingApprovals.length > 0) {
    await sendTelegramAlert(businessId,
      `⏰ You have ${agingApprovals.length} approval(s) waiting over 2 hours.\nSend /approvals to review.`
    );
  }

  // Log the check run
  await logHeartbeatCheck(businessId, 'urgent', (uncontacted?.length || 0) + (agingApprovals?.length || 0));
}

// ── Pipeline Checks (hourly) ──────────────────────────────────────────────────

async function runPipelineChecks(businessId, bizName) {
  const supabase = db();
  const stallCutoff = new Date(Date.now() - STALL_HOURS * 60 * 60 * 1000).toISOString();

  // Check 1: Stalled opportunities
  const { data: stalled } = await supabase
    .from('opportunities')
    .select('id,name,stage,value,stalled_at,leads(name)')
    .eq('business_id', businessId)
    .not('stage', 'in', '("won","lost")')
    .lt('stalled_at', stallCutoff);

  for (const opp of (stalled || [])) {
    await fireOpportunityAlert(businessId, opp);
  }

  // Check 2: Overdue tasks
  const { data: overdue } = await supabase
    .from('tasks')
    .select('id,title,priority,due_at,assigned_agent')
    .eq('business_id', businessId)
    .eq('status', 'pending')
    .lt('due_at', new Date().toISOString());

  for (const task of (overdue || [])) {
    // Auto-mark as overdue (no approval needed)
    await enqueue(businessId, {
      action_type: 'mark_task_overdue',
      payload: { task_id: task.id },
      priority: task.priority,
      status: 'pending',
      approved_by: 'heartbeat',
    });
  }

  if (overdue && overdue.length > 0) {
    await postToDiscord(businessId, 'alerts',
      `📋 **${overdue.length} task(s) marked overdue**\n` +
      overdue.slice(0, 3).map(t => `• ${t.title}`).join('\n')
    );
  }

  // Check 3: Action queue depth
  const { count: queueDepth } = await supabase
    .from('action_queue')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('status', 'pending');

  if (queueDepth > 20) {
    await postToDiscord(businessId, 'system',
      `⚠️ Action queue depth is ${queueDepth} — worker may be falling behind.`
    );
  }

  await logHeartbeatCheck(businessId, 'pipeline',
    (stalled?.length || 0) + (overdue?.length || 0)
  );
}

// ── Strategy Checks (daily) ───────────────────────────────────────────────────

async function runStrategyChecks(businessId, bizName) {
  const supabase = db();

  // Fetch metrics for trend analysis
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentMetrics } = await supabase
    .from('metrics')
    .select('metric_key,value,period_start')
    .eq('business_id', businessId)
    .gte('period_start', sevenDaysAgo)
    .order('period_start', { ascending: false });

  // Build a simple trend analysis
  const alerts = [];

  // Check close rate trend
  const closeRates = (recentMetrics || [])
    .filter(m => m.metric_key === 'close_rate')
    .map(m => m.value);

  if (closeRates.length >= 3) {
    const recent  = closeRates.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
    const older   = closeRates.slice(3).reduce((a, b) => a + b, 0) / Math.max(closeRates.slice(3).length, 1);
    if (older > 0 && recent < older * 0.85) {
      alerts.push(`Close rate trending down: ${(recent * 100).toFixed(1)}% vs ${(older * 100).toFixed(1)}% baseline`);
    }
  }

  // Post strategy digest to Discord
  const context = await buildContext({ businessId, userInput: 'daily strategy analysis' });
  const oppCount = context.crm_snapshot?.open_opportunities?.length || 0;
  const totalValue = (context.crm_snapshot?.open_opportunities || [])
    .reduce((s, o) => s + parseFloat(o.value || 0), 0);

  let digest = `📊 **Daily Strategy Check**\n`;
  digest += `Pipeline: ${oppCount} deals | $${totalValue.toLocaleString()} total\n`;
  if (alerts.length > 0) {
    digest += `\n⚠️ Alerts:\n${alerts.map(a => `• ${a}`).join('\n')}`;
  } else {
    digest += `✅ No strategic alerts.`;
  }

  await postToDiscord(businessId, 'insights', digest);

  // Referral checks (Priority 4)
  await runReferralChecks(businessId);

  // Meeting briefings (Priority 2)
  await runMeetingBriefings(businessId);

  await logHeartbeatCheck(businessId, 'strategy', alerts.length);
}

// ── Alert Helpers ─────────────────────────────────────────────────────────────

async function fireLeadAlert(businessId, lead, alertType) {
  const supabase = db();

  // Check cooldown — don't re-alert the same lead within COOLDOWN_HOURS
  const cooldownCutoff = new Date(Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
  const { data: existing } = await supabase
    .from('heartbeat_events')
    .select('id')
    .eq('business_id', businessId)
    .eq('entity_type', 'lead')
    .eq('entity_id', lead.id)
    .gt('alerted_at', cooldownCutoff)
    .limit(1);

  if (existing && existing.length > 0) return; // In cooldown

  // Log the heartbeat event
  await supabase.from('heartbeat_events').insert({
    business_id:   businessId,
    entity_type:   'lead',
    entity_id:     lead.id,
    severity:      'high',
    description:   `Lead ${lead.name} has not been contacted`,
    payload:       { lead, alert_type: alertType },
    cooldown_until: new Date(Date.now() + COOLDOWN_HOURS * 60 * 60 * 1000).toISOString(),
  });

  // Build context and run Sales agent for AI triage
  try {
    const context = await buildContext({ businessId, userInput: `follow up with ${lead.name}`, entityType: 'lead', entityId: lead.id });
    const agentOutput = await runSalesAgent({
      task: `Lead ${lead.name} has not been contacted in ${alertType === 'uncontacted' ? 'too long' : ''}. Draft a personalized follow-up message and recommend next action.`,
      context,
    });

    // Enqueue draft (auto) and send (needs approval)
    const messageAction = agentOutput.proposed_actions?.find(a => a.action_type === 'draft_message' || a.action_type === 'send_message');
    if (messageAction) {
      await enqueue(businessId, {
        action_type: 'approval_required' in messageAction ? 'send_message' : 'draft_message',
        payload: {
          ...messageAction.payload,
          lead_id: lead.id,
          _draft_from_heartbeat: true,
        },
        priority: 8,
        status: 'approval_required',
      });
    }

    // Alert operator
    const minutesGap = lead.last_contacted_at
      ? Math.floor((Date.now() - new Date(lead.last_contacted_at)) / 60000)
      : null;

    const gapText = minutesGap ? `${minutesGap} min ago` : 'never contacted';
    await sendTelegramAlert(businessId,
      `🔔 *Uncontacted Lead*: ${lead.name}\n` +
      `Score: ${lead.lead_score || '?'}/100 | Last contact: ${gapText}\n` +
      `${agentOutput.summary}\n\nDraft message queued — send /approvals to review.`
    );
  } catch (err) {
    // If AI triage fails, still send a basic alert
    logger.warn('AI triage failed for lead alert:', err.message);
    await sendTelegramAlert(businessId,
      `🔔 *Uncontacted Lead*: ${lead.name} — no contact in too long. Send /lead ${lead.name} for details.`
    );
  }
}

async function fireOpportunityAlert(businessId, opp) {
  const supabase = db();
  const cooldownCutoff = new Date(Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
  const { data: existing } = await supabase
    .from('heartbeat_events')
    .select('id').eq('business_id', businessId).eq('entity_type', 'opportunity')
    .eq('entity_id', opp.id).gt('alerted_at', cooldownCutoff).limit(1);

  if (existing && existing.length > 0) return;

  const daysSinceMoved = Math.floor((Date.now() - new Date(opp.stalled_at)) / 86400000);

  await supabase.from('heartbeat_events').insert({
    business_id:   businessId,
    entity_type:   'opportunity',
    entity_id:     opp.id,
    severity:      parseFloat(opp.value) > 2000 ? 'high' : 'medium',
    description:   `Deal ${opp.name} stalled at ${opp.stage} for ${daysSinceMoved} days`,
    payload:       opp,
    cooldown_until: new Date(Date.now() + COOLDOWN_HOURS * 60 * 60 * 1000).toISOString(),
  });

  // Auto-flag (no approval needed)
  await enqueue(businessId, {
    action_type: 'flag_stalled_deal',
    payload: { opportunity_id: opp.id, days_stalled: daysSinceMoved },
    priority: parseFloat(opp.value) > 2000 ? 8 : 5,
    status: 'pending',
    approved_by: 'heartbeat',
  });

  // High-value deals get Telegram alert
  if (parseFloat(opp.value) > 2000) {
    await sendTelegramAlert(businessId,
      `🚨 *Stalled Deal*: ${opp.name}\n` +
      `$${opp.value} | Stage: ${opp.stage} | ${daysSinceMoved} days\n` +
      `Lead: ${opp.leads?.name || 'unknown'}\n\nSend /pipeline for full view.`
    );
  }
}

// ── Referral Checks (daily, Priority 4) ──────────────────────────────────────

async function runReferralChecks(businessId) {
  const supabase = db();
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Check 1: Won opportunities with no referral request sent in 60 days
  const { data: wonOpps } = await supabase
    .from('opportunities')
    .select('id,name,value,lead_id,updated_at')
    .eq('business_id', businessId)
    .eq('stage', 'won')
    .gt('updated_at', sixtyDaysAgo); // won within last 60 days

  for (const opp of (wonOpps || [])) {
    if (!opp.lead_id) continue;

    // Check if a referral request interaction exists for this lead
    const { data: existing } = await supabase
      .from('interactions')
      .select('id')
      .eq('business_id', businessId)
      .eq('lead_id', opp.lead_id)
      .contains('metadata', { type: 'referral_request' })
      .limit(1);

    if (!existing || existing.length === 0) {
      // Fire referral opportunity event
      await enqueue(businessId, {
        action_type:      'send_referral_request',
        action_category:  'communication',
        execution_target: 'api',
        explanation:      `Deal "${opp.name}" was won recently — ideal time to ask for a referral.`,
        payload: {
          lead_id: opp.lead_id,
          opportunity_id: opp.id,
          opportunity_name: opp.name,
          trigger: 'heartbeat_won_deal',
          message: `Hi, I wanted to personally thank you for choosing us for ${opp.name}. If you know anyone who could benefit from what we do, I'd love an introduction.`,
        },
        priority: 4,
        status: 'approval_required',
      });

      logger.info(`Referral opportunity queued for opportunity ${opp.id}`);
    }
  }

  // Check 2: Pending commissions older than 30 days
  const { data: pendingCommissions } = await supabase
    .from('commissions')
    .select('id,affiliate_id,amount,created_at,affiliates(name,email)')
    .eq('business_id', businessId)
    .eq('status', 'pending')
    .lt('created_at', thirtyDaysAgo);

  if (pendingCommissions && pendingCommissions.length > 0) {
    const totalOwed = pendingCommissions.reduce((s, c) => s + parseFloat(c.amount || 0), 0);
    await postToDiscord(businessId, 'alerts',
      `💰 **Pending Commissions**: ${pendingCommissions.length} commission(s) owed to affiliates\n` +
      `Total: $${totalOwed.toFixed(2)} | Oldest: ${pendingCommissions[0].created_at?.split('T')[0]}\n` +
      `Review and pay via /approvals or Settings → Integrations`
    );
  }
}

// ── Meeting Briefings (daily, Priority 2) ────────────────────────────────────

async function runMeetingBriefings(businessId) {
  const supabase = db();
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  // Find meetings in next 24 hours that haven't had a briefing sent
  const { data: upcomingMeetings } = await supabase
    .from('meetings')
    .select('id,title,start_time,lead_id,platform_event_id')
    .eq('business_id', businessId)
    .eq('status', 'scheduled')
    .eq('briefing_sent', false)
    .gte('start_time', now.toISOString())
    .lte('start_time', in24h);

  if (!upcomingMeetings || upcomingMeetings.length === 0) return;

  const { getMeetingBriefing } = require('../integrations/calendar');

  for (const meeting of upcomingMeetings) {
    try {
      const briefing = await getMeetingBriefing({
        businessId,
        eventId: meeting.platform_event_id,
        meetingId: meeting.id,
      });

      await sendTelegramAlert(businessId, briefing);

      await supabase
        .from('meetings')
        .update({ briefing_sent: true })
        .eq('id', meeting.id);

      logger.info(`Meeting briefing sent for meeting ${meeting.id}`);
    } catch (err) {
      logger.warn(`Meeting briefing failed for ${meeting.id}:`, err.message);
    }
  }
}

async function logHeartbeatCheck(businessId, checkType, violationsFound) {
  const supabase = db();
  try {
    await supabase.from('heartbeat_checks').insert({
      business_id:      businessId,
      check_type:       checkType,
      frequency:        checkType === 'urgent' ? '5min' : checkType === 'pipeline' ? 'hourly' : 'daily',
      last_run_at:      new Date().toISOString(),
      violations_found: violationsFound,
      result:           { ran_at: new Date().toISOString(), violations: violationsFound },
    });
  } catch (e) {}
}

module.exports = { startHeartbeat };
