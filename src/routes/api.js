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
  const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:3001';
  if (!origin || origin === dashboardUrl || origin === 'http://localhost:3001') {
    res.setHeader('Access-Control-Allow-Origin', origin || dashboardUrl);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
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
