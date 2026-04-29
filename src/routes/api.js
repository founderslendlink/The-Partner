/**
 * Dashboard REST API Routes
 * Mounted at /api in src/index.js
 */

const express = require('express');
const router = express.Router();
const { db } = require('../utils/supabase');
const { logger } = require('../utils/logger');
const { buildContext } = require('../context/builder');
const { runCEOAgent } = require('../agents/ceo');
const { processProposedActions } = require('../permissions/layer');
const { enqueue, enqueueMany, approveAction, rejectAction } = require('../queue/enqueue');
const { writeMemoryUpdates } = require('../memory/manager');
const { decomposeTask } = require('../decomposition/decompose');

// ── CORS for dashboard ────────────────────────────────────────────────────────
router.use((req, res, next) => {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// ── POST /api/command ─────────────────────────────────────────────────────────
// Runs the same CEO agent flow used by Telegram.
// body: { message: string, businessId: string }
router.post('/command', async (req, res) => {
  const { message, businessId } = req.body;
  if (!message || !businessId) {
    return res.status(400).json({ error: 'message and businessId are required' });
  }

  try {
    const context = await buildContext({ businessId, userInput: message });

    const decompositionContext = await decomposeTask({
      businessId,
      task: message,
      context,
    });

    const agentOutput = await runCEOAgent({
      task: message,
      context,
      decompositionContext,
    });

    await writeMemoryUpdates(businessId, agentOutput.memory_updates);

    const auto_actions = [];
    const approval_actions = [];

    if (agentOutput.proposed_actions?.length > 0) {
      const { auto_actions: autos, approval_actions: approvals } =
        await processProposedActions(businessId, agentOutput.proposed_actions, agentOutput.confidence);

      auto_actions.push(...(autos || []));
      approval_actions.push(...(approvals || []));

      if (auto_actions.length > 0) {
        await enqueueMany(
          businessId,
          auto_actions.map((a) => ({ ...a, status: 'pending', approved_by: 'auto' }))
        );
      }

      for (const action of approval_actions) {
        await enqueue(businessId, { ...action, status: 'approval_required' });
      }
    }

    res.json({
      summary: agentOutput.summary,
      reasoning_summary: agentOutput.reasoning_summary,
      confidence: agentOutput.confidence,
      proposed_actions: agentOutput.proposed_actions || [],
      approval_required: approval_actions.length,
    });
  } catch (err) {
    logger.error('API /command error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/actions/:id/approve ─────────────────────────────────────────────
router.post('/actions/:id/approve', async (req, res) => {
  try {
    await approveAction(req.params.id, 'dashboard');
    res.json({ success: true });
  } catch (err) {
    logger.error('API approve error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/actions/:id/reject ──────────────────────────────────────────────
router.post('/actions/:id/reject', async (req, res) => {
  const { reason } = req.body;
  try {
    await rejectAction(req.params.id, reason || 'Rejected via dashboard');
    res.json({ success: true });
  } catch (err) {
    logger.error('API reject error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/businesses/:id/stats ─────────────────────────────────────────────
router.get('/businesses/:id/stats', async (req, res) => {
  const supabase = db();
  const { id } = req.params;

  try {
    const [leadsRes, oppsRes, tasksRes, approvalsRes, decisionsRes] = await Promise.all([
      supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', id)
        .not('status', 'in', '(won,lost)'),
      supabase
        .from('opportunities')
        .select('value,stage')
        .eq('business_id', id)
        .not('stage', 'in', '("won","lost")'),
      supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', id)
        .in('status', ['pending', 'in_progress']),
      supabase
        .from('action_queue')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', id)
        .eq('status', 'approval_required'),
      supabase
        .from('decision_logs')
        .select('id,agent,task,confidence,reasoning_summary,created_at')
        .eq('business_id', id)
        .order('created_at', { ascending: false })
        .limit(5),
    ]);

    const pipeline_value = (oppsRes.data || []).reduce(
      (sum, o) => sum + (parseFloat(o.value) || 0), 0
    );

    res.json({
      leads_count: leadsRes.count || 0,
      pipeline_value,
      open_tasks: tasksRes.count || 0,
      pending_approvals: approvalsRes.count || 0,
      recent_decisions: decisionsRes.data || [],
    });
  } catch (err) {
    logger.error('API stats error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/notifications ────────────────────────────────────────────────────
router.get('/notifications', async (req, res) => {
  const { businessId, limit = '20' } = req.query;
  if (!businessId) return res.status(400).json({ error: 'businessId is required' });

  const supabase = db();
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(parseInt(limit, 10));

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── PATCH /api/permissions/:businessId/:actionType ────────────────────────────
router.patch('/permissions/:businessId/:actionType', async (req, res) => {
  const { businessId, actionType } = req.params;
  const { rule } = req.body;

  if (!['auto', 'approval_required', 'blocked'].includes(rule)) {
    return res.status(400).json({ error: 'rule must be auto, approval_required, or blocked' });
  }

  const supabase = db();
  const { error } = await supabase
    .from('permission_rules')
    .update({ rule, updated_at: new Date().toISOString() })
    .eq('business_id', businessId)
    .eq('action_type', actionType);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── PATCH /api/businesses/:id/operator-mode ───────────────────────────────────
router.patch('/businesses/:id/operator-mode', async (req, res) => {
  const { mode } = req.body;
  const { id } = req.params;

  if (!['assisted', 'semi_autonomous', 'autonomous'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be assisted, semi_autonomous, or autonomous' });
  }

  const supabase = db();
  const { error } = await supabase
    .from('businesses')
    .update({ operator_mode: mode, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── PATCH /api/businesses/:id ─────────────────────────────────────────────────
router.patch('/businesses/:id', async (req, res) => {
  const { id } = req.params;
  const { name, timezone, mode } = req.body;

  const updates = { updated_at: new Date().toISOString() };
  if (name !== undefined) updates.name = name;
  if (timezone !== undefined) updates.timezone = timezone;
  if (mode !== undefined) updates.mode = mode;

  const supabase = db();
  const { error } = await supabase
    .from('businesses')
    .update(updates)
    .eq('id', id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── POST /api/integrations/email/connect ─────────────────────────────────────
router.post('/integrations/email/connect', async (req, res) => {
  const { businessId, provider, apiKey, smtpHost, smtpPort, smtpUser, smtpPass, fromEmail, fromName } = req.body;
  if (!businessId || !provider || !fromEmail || !fromName) {
    return res.status(400).json({ error: 'businessId, provider, fromEmail, and fromName are required' });
  }

  const supabase = db();
  const row = {
    business_id: businessId,
    provider,
    from_email:  fromEmail,
    from_name:   fromName,
    api_key:     apiKey || null,
    smtp_host:   smtpHost || null,
    smtp_port:   smtpPort ? parseInt(smtpPort) : null,
    smtp_user:   smtpUser || null,
    smtp_pass:   smtpPass || null,
    connected_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('email_connections')
    .upsert(row, { onConflict: 'business_id,provider' });

  if (error) {
    logger.error('Email connect error:', JSON.stringify(error));
    return res.status(500).json({ error: error.message });
  }
  res.json({ success: true });
});

// ── POST /api/integrations/email/test ────────────────────────────────────────
router.post('/integrations/email/test', async (req, res) => {
  const { businessId, to } = req.body;
  if (!businessId || !to) return res.status(400).json({ error: 'businessId and to are required' });

  try {
    const { sendEmail } = require('../integrations/email');
    const result = await sendEmail({
      to,
      subject: 'Test email from The Partner',
      body: '<p>This is a test email sent from <strong>The Partner</strong>. Your email integration is working correctly.</p>',
      businessId,
      leadId: null,
    });
    res.json(result);
  } catch (err) {
    logger.error('Email test error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/integrations/sms/connect ───────────────────────────────────────
router.post('/integrations/sms/connect', async (req, res) => {
  const { businessId, accountSid, authToken, phoneNumber } = req.body;
  if (!businessId || !accountSid || !authToken || !phoneNumber) {
    return res.status(400).json({ error: 'businessId, accountSid, authToken, and phoneNumber are required' });
  }

  const supabase = db();
  const { error } = await supabase
    .from('sms_connections')
    .upsert({
      business_id:  businessId,
      account_sid:  accountSid,
      auth_token:   authToken,
      phone_number: phoneNumber,
      connected_at: new Date().toISOString(),
    }, { onConflict: 'business_id' });

  if (error) {
    logger.error('SMS connect error:', JSON.stringify(error));
    return res.status(500).json({ error: error.message });
  }
  res.json({ success: true });
});

// ── POST /api/integrations/sms/test ──────────────────────────────────────────
router.post('/integrations/sms/test', async (req, res) => {
  const { businessId, to } = req.body;
  if (!businessId || !to) return res.status(400).json({ error: 'businessId and to are required' });

  try {
    const { sendSMS } = require('../integrations/sms');
    const result = await sendSMS({
      to,
      message: 'Test SMS from The Partner — your SMS integration is working!',
      businessId,
      leadId: null,
    });
    res.json(result);
  } catch (err) {
    logger.error('SMS test error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/integrations/status ──────────────────────────────────────────────
router.get('/integrations/status', async (req, res) => {
  const { businessId } = req.query;
  if (!businessId) return res.status(400).json({ error: 'businessId is required' });

  const supabase = db();
  const [emailRes, smsRes, calendarRes] = await Promise.all([
    supabase.from('email_connections').select('provider,from_email,connected_at').eq('business_id', businessId).limit(1),
    supabase.from('sms_connections').select('phone_number,connected_at').eq('business_id', businessId).limit(1),
    supabase.from('calendar_connections').select('provider,calendar_id,connected_at').eq('business_id', businessId).limit(1),
  ]);

  res.json({
    email:    emailRes.data?.[0] || null,
    sms:      smsRes.data?.[0] || null,
    calendar: calendarRes.data?.[0] || null,
  });
});

// ── Automation Routes ─────────────────────────────────────────────────────────

// GET /api/automations?businessId=
router.get('/automations', async (req, res) => {
  const { businessId } = req.query;
  if (!businessId) return res.status(400).json({ error: 'businessId is required' });

  const supabase = db();
  const { data, error } = await supabase
    .from('automations')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// POST /api/automations
router.post('/automations', async (req, res) => {
  const { business_id, name, description, trigger_type, trigger_conditions, steps } = req.body;
  if (!business_id || !name || !trigger_type) {
    return res.status(400).json({ error: 'business_id, name, and trigger_type are required' });
  }

  const supabase = db();
  const { data, error } = await supabase
    .from('automations')
    .insert({
      business_id,
      name,
      description: description || null,
      trigger_type,
      trigger_conditions: trigger_conditions || {},
      steps: steps || [],
      active: true,
    })
    .select()
    .single();

  if (error) {
    logger.error('Create automation error:', JSON.stringify(error));
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json(data);
});

// PUT /api/automations/:id
router.put('/automations/:id', async (req, res) => {
  const { name, description, trigger_type, trigger_conditions, steps, active } = req.body;
  const supabase = db();

  const updates = { updated_at: new Date().toISOString() };
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (trigger_type !== undefined) updates.trigger_type = trigger_type;
  if (trigger_conditions !== undefined) updates.trigger_conditions = trigger_conditions;
  if (steps !== undefined) updates.steps = steps;
  if (active !== undefined) updates.active = active;

  const { data, error } = await supabase
    .from('automations')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/automations/:id
router.delete('/automations/:id', async (req, res) => {
  const supabase = db();
  const { error } = await supabase.from('automations').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// POST /api/automations/:id/toggle
router.post('/automations/:id/toggle', async (req, res) => {
  const supabase = db();
  const { data: current } = await supabase
    .from('automations').select('active').eq('id', req.params.id).single();
  if (!current) return res.status(404).json({ error: 'Automation not found' });

  const { data, error } = await supabase
    .from('automations')
    .update({ active: !current.active, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ active: data.active });
});

// POST /api/automations/:id/test
router.post('/automations/:id/test', async (req, res) => {
  const { businessId, leadId } = req.body;
  if (!businessId) return res.status(400).json({ error: 'businessId is required' });

  try {
    const { runAutomation } = require('../automation/engine');
    const run = await runAutomation({
      automationId: req.params.id,
      businessId,
      triggerEntityType: 'lead',
      triggerEntityId: leadId || null,
      testMode: true,
    });
    res.json(run);
  } catch (err) {
    logger.error('Automation test error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/automations/:id/runs
router.get('/automations/:id/runs', async (req, res) => {
  const supabase = db();
  const { data, error } = await supabase
    .from('automation_runs')
    .select('*')
    .eq('automation_id', req.params.id)
    .order('started_at', { ascending: false })
    .limit(20);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── POST /api/opportunities ───────────────────────────────────────────────────
router.post('/opportunities', async (req, res) => {
  const { business_id, name, value, lead_id, stage, close_date } = req.body;
  if (!business_id || !name) {
    return res.status(400).json({ error: 'business_id and name are required' });
  }

  const supabase = db();
  const { data, error } = await supabase
    .from('opportunities')
    .insert({
      business_id,
      name,
      value: parseFloat(value) || 0,
      lead_id: lead_id || null,
      stage: stage || 'prospect',
      close_date: close_date || null,
      stalled_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    logger.error('API create opportunity error:', JSON.stringify(error));
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json(data);
});

module.exports = router;
