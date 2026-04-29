/**
 * Automation Engine
 * Executes automation step sequences and checks event triggers.
 */

const { db } = require('../utils/supabase');
const { logger } = require('../utils/logger');
const { callAI } = require('../utils/ai');

// ── Run Automation ─────────────────────────────────────────────────────────────

async function runAutomation({ automationId, businessId, triggerEntityType, triggerEntityId, testMode = false }) {
  const supabase = db();

  // Load automation
  const { data: automation, error: autoErr } = await supabase
    .from('automations')
    .select('*')
    .eq('id', automationId)
    .single();

  if (autoErr || !automation) throw new Error(`Automation ${automationId} not found`);

  // Create run record
  const { data: run } = await supabase
    .from('automation_runs')
    .insert({
      automation_id:       automationId,
      business_id:         businessId,
      trigger_entity_type: triggerEntityType || null,
      trigger_entity_id:   triggerEntityId || null,
      status:              'running',
      test_mode:           testMode,
    })
    .select()
    .single();

  const runId = run?.id;
  const results = [];

  try {
    // Load trigger entity data
    const entityData = triggerEntityId ? await loadEntity(supabase, triggerEntityType, triggerEntityId) : {};

    // Execute steps sequentially
    const steps = automation.steps || [];
    let currentStepIndex = 0;
    let nextStepId = steps[0]?.id || null;

    while (nextStepId && currentStepIndex < steps.length) {
      const step = steps.find(s => s.id === nextStepId);
      if (!step) break;

      const stepResult = await executeStep({
        step,
        businessId,
        entityData,
        triggerEntityType,
        triggerEntityId,
        testMode,
        supabase,
      });

      results.push({ stepId: step.id, type: step.type, result: stepResult });

      // Handle branching for conditions
      if (step.type === 'condition') {
        nextStepId = stepResult.conditionMet ? (step.next_true || null) : (step.next_false || null);
      } else if (step.type === 'wait') {
        // Pause execution — will be resumed by event processor
        if (runId && !testMode) {
          await supabase.from('automation_runs').update({
            status:         'waiting',
            current_step_id: step.next || null,
            resume_at:      stepResult.resumeAt,
            steps_completed: currentStepIndex + 1,
            result:          { steps: results },
          }).eq('id', runId);
          return { status: 'waiting', steps: results, resume_at: stepResult.resumeAt };
        }
        nextStepId = step.next || null;
      } else {
        nextStepId = step.next || null;
      }

      currentStepIndex++;

      // Safety limit
      if (currentStepIndex > 50) {
        logger.warn(`Automation ${automationId} exceeded 50 step limit, stopping`);
        break;
      }
    }

    // Mark run completed
    if (runId) {
      await supabase.from('automation_runs').update({
        status:          'completed',
        steps_completed: currentStepIndex,
        result:          { steps: results },
        completed_at:    new Date().toISOString(),
      }).eq('id', runId);
    }

    // Increment run count
    await supabase.from('automations').update({
      run_count:   supabase.rpc ? automation.run_count + 1 : automation.run_count + 1,
      last_run_at: new Date().toISOString(),
    }).eq('id', automationId).catch(() => {});

    return { status: 'completed', steps: results };
  } catch (err) {
    logger.error(`Automation ${automationId} failed:`, err.message);
    if (runId) {
      await supabase.from('automation_runs').update({
        status:       'failed',
        error:        err.message,
        completed_at: new Date().toISOString(),
      }).eq('id', runId).catch(() => {});
    }
    throw err;
  }
}

// ── Execute Single Step ────────────────────────────────────────────────────────

async function executeStep({ step, businessId, entityData, triggerEntityType, triggerEntityId, testMode, supabase }) {
  const config = step.config || {};

  switch (step.type) {
    case 'wait': {
      const { duration = 1, unit = 'hours' } = config;
      const ms = unit === 'minutes' ? duration * 60000
               : unit === 'days'    ? duration * 86400000
               : duration * 3600000;
      const resumeAt = new Date(Date.now() + ms).toISOString();
      return { waited: true, duration, unit, resumeAt };
    }

    case 'send_email': {
      if (testMode) return { test: true, action: 'send_email', to: entityData.email, subject: config.subject };
      const { sendEmail } = require('../integrations/email');
      const subject = interpolate(config.subject || '', entityData);
      const body    = interpolate(config.body    || '', entityData);
      return sendEmail({ to: entityData.email, subject, body, businessId, leadId: triggerEntityId });
    }

    case 'send_sms': {
      if (testMode) return { test: true, action: 'send_sms', to: entityData.phone, message: config.message };
      const { sendSMS } = require('../integrations/sms');
      const message = interpolate(config.message || '', entityData);
      return sendSMS({ to: entityData.phone, message, businessId, leadId: triggerEntityId });
    }

    case 'create_task': {
      const dueAt = config.due_in_hours
        ? new Date(Date.now() + (config.due_in_hours || 24) * 3600000).toISOString()
        : null;
      if (testMode) return { test: true, action: 'create_task', title: config.title };
      const { data } = await supabase.from('tasks').insert({
        business_id:         businessId,
        title:               interpolate(config.title || 'Follow up', entityData),
        priority:            config.priority || 5,
        due_at:              dueAt,
        related_entity_type: triggerEntityType || null,
        related_entity_id:   triggerEntityId || null,
        status:              'pending',
      }).select().single();
      return { task_id: data?.id };
    }

    case 'update_lead': {
      if (!triggerEntityId || triggerEntityType !== 'lead') return { skipped: true, reason: 'no lead entity' };
      if (testMode) return { test: true, action: 'update_lead', field: config.field, value: config.value };
      await supabase.from('leads').update({ [config.field]: config.value }).eq('id', triggerEntityId);
      return { updated: true, field: config.field, value: config.value };
    }

    case 'add_tag': {
      if (!triggerEntityId) return { skipped: true };
      if (testMode) return { test: true, action: 'add_tag', tag: config.tag };
      const { data: current } = await supabase.from('leads').select('metadata').eq('id', triggerEntityId).single();
      const tags = [...new Set([...(current?.metadata?.tags || []), config.tag])];
      await supabase.from('leads').update({ metadata: { ...(current?.metadata || {}), tags } }).eq('id', triggerEntityId);
      return { tagged: true, tag: config.tag };
    }

    case 'ai_action': {
      const contextSummary = JSON.stringify(entityData, null, 2).slice(0, 2000);
      const aiResult = await callAI({
        systemPrompt: `You are an AI business assistant executing an automation step. Follow the instruction precisely. Output plain text only — no JSON wrapper needed here.`,
        userMessage: `${config.instruction}\n\nEntity context:\n${contextSummary}`,
        maxTokens: 512,
      });

      const output = typeof aiResult === 'string' ? aiResult : (aiResult.summary || JSON.stringify(aiResult));

      if (config.requires_approval && !testMode) {
        const { enqueue } = require('../queue/enqueue');
        await enqueue(businessId, {
          action_type: config.action_type || 'send_message',
          payload: { message: output, lead_id: triggerEntityId, source: 'automation' },
          priority: 6,
          status: 'approval_required',
        });
        return { ai_output: output, queued_for_approval: true };
      }

      if (!testMode && config.action_type === 'send_sms' && entityData.phone) {
        const { sendSMS } = require('../integrations/sms');
        await sendSMS({ to: entityData.phone, message: output, businessId, leadId: triggerEntityId });
      } else if (!testMode && config.action_type === 'send_email' && entityData.email) {
        const { sendEmail } = require('../integrations/email');
        await sendEmail({ to: entityData.email, subject: 'Follow up', body: output, businessId, leadId: triggerEntityId });
      }

      return { ai_output: output, action_type: config.action_type };
    }

    case 'condition': {
      const fieldValue = getNestedValue(entityData, config.field);
      const conditionMet = evaluateCondition(fieldValue, config.operator, config.value);
      return { conditionMet, field: config.field, fieldValue, operator: config.operator, expected: config.value };
    }

    case 'webhook': {
      if (testMode) return { test: true, action: 'webhook', url: config.url };
      const res = await require('axios').default({
        method: config.method || 'POST',
        url: config.url,
        data: { businessId, entity: entityData, triggerEntityId, triggerEntityType },
        timeout: 10000,
      });
      return { status: res.status };
    }

    default:
      return { skipped: true, reason: `unknown step type: ${step.type}` };
  }
}

// ── Check Triggers ─────────────────────────────────────────────────────────────

async function checkTriggers({ businessId, eventType, entityType, entityId }) {
  const supabase = db();

  // Map event type to automation trigger_type
  const triggerMap = {
    'lead.created':              'lead_created',
    'lead.status_changed':       'lead_status_changed',
    'opportunity.stage_changed': 'opportunity_stage_changed',
    'opportunity.stalled':       'opportunity_stalled',
    'task.overdue':              'task_overdue',
    'meeting.booked':            'meeting_booked',
    'meeting.completed':         'meeting_completed',
    'deal.won':                  'deal_won',
    'deal.lost':                 'deal_lost',
  };

  const triggerType = triggerMap[eventType];
  if (!triggerType) return;

  const { data: automations } = await supabase
    .from('automations')
    .select('id,trigger_conditions')
    .eq('business_id', businessId)
    .eq('trigger_type', triggerType)
    .eq('active', true);

  if (!automations || automations.length === 0) return;

  const entityData = entityId ? await loadEntity(supabase, entityType, entityId) : {};

  for (const automation of automations) {
    try {
      // Evaluate trigger conditions if any
      const conditions = automation.trigger_conditions || {};
      if (Object.keys(conditions).length > 0 && !evaluateTriggerConditions(conditions, entityData)) {
        continue;
      }

      await runAutomation({
        automationId:        automation.id,
        businessId,
        triggerEntityType:   entityType,
        triggerEntityId:     entityId,
      });
    } catch (err) {
      logger.error(`Automation ${automation.id} trigger failed:`, err.message);
    }
  }
}

// ── Resume Waiting Runs ───────────────────────────────────────────────────────

async function resumeWaitingRuns() {
  const supabase = db();
  const { data: waiting } = await supabase
    .from('automation_runs')
    .select('id,automation_id,business_id,trigger_entity_type,trigger_entity_id,current_step_id,result')
    .eq('status', 'waiting')
    .lte('resume_at', new Date().toISOString())
    .limit(10);

  if (!waiting || waiting.length === 0) return;

  for (const run of waiting) {
    try {
      // Mark as running again
      await supabase.from('automation_runs')
        .update({ status: 'running' }).eq('id', run.id);

      // Load automation and continue from where we left off
      const { data: automation } = await supabase
        .from('automations').select('*').eq('id', run.automation_id).single();
      if (!automation) continue;

      const entityData = run.trigger_entity_id
        ? await loadEntity(supabase, run.trigger_entity_type, run.trigger_entity_id) : {};

      // Find the step to resume from
      const steps = automation.steps || [];
      const resumeStepIdx = run.current_step_id
        ? steps.findIndex(s => s.id === run.current_step_id)
        : 0;
      const remainingSteps = resumeStepIdx >= 0 ? steps.slice(resumeStepIdx) : [];

      const prevResults = run.result?.steps || [];
      const newResults = [];

      let nextStepId = remainingSteps[0]?.id || null;
      let stepCount = resumeStepIdx;

      while (nextStepId && stepCount < steps.length) {
        const step = steps.find(s => s.id === nextStepId);
        if (!step) break;

        const stepResult = await executeStep({
          step, businessId: run.business_id, entityData,
          triggerEntityType: run.trigger_entity_type,
          triggerEntityId: run.trigger_entity_id,
          testMode: false, supabase,
        });

        newResults.push({ stepId: step.id, type: step.type, result: stepResult });

        if (step.type === 'wait') {
          await supabase.from('automation_runs').update({
            status: 'waiting',
            current_step_id: step.next || null,
            resume_at: stepResult.resumeAt,
            steps_completed: stepCount + 1,
            result: { steps: [...prevResults, ...newResults] },
          }).eq('id', run.id);
          return;
        }

        nextStepId = step.type === 'condition'
          ? (stepResult.conditionMet ? step.next_true : step.next_false)
          : step.next || null;
        stepCount++;
      }

      await supabase.from('automation_runs').update({
        status: 'completed',
        steps_completed: stepCount,
        result: { steps: [...prevResults, ...newResults] },
        completed_at: new Date().toISOString(),
      }).eq('id', run.id);
    } catch (err) {
      logger.error(`Failed to resume automation run ${run.id}:`, err.message);
      await supabase.from('automation_runs')
        .update({ status: 'failed', error: err.message, completed_at: new Date().toISOString() })
        .eq('id', run.id).catch(() => {});
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadEntity(supabase, entityType, entityId) {
  if (!entityId || !entityType) return {};

  const tableMap = { lead: 'leads', opportunity: 'opportunities', task: 'tasks', meeting: 'meetings' };
  const table = tableMap[entityType];
  if (!table) return {};

  const { data } = await supabase.from(table).select('*').eq('id', entityId).single();
  return data || {};
}

function interpolate(template, data) {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, path) => {
    const val = getNestedValue(data, path);
    return val !== undefined ? String(val) : '';
  });
}

function getNestedValue(obj, path) {
  return path.split('.').reduce((curr, key) => curr?.[key], obj);
}

function evaluateCondition(fieldValue, operator, expected) {
  switch (operator) {
    case 'gt':       return Number(fieldValue) > Number(expected);
    case 'lt':       return Number(fieldValue) < Number(expected);
    case 'eq':       return String(fieldValue) === String(expected);
    case 'neq':      return String(fieldValue) !== String(expected);
    case 'contains': return String(fieldValue || '').toLowerCase().includes(String(expected).toLowerCase());
    default:         return false;
  }
}

function evaluateTriggerConditions(conditions, entityData) {
  return Object.entries(conditions).every(([field, expected]) => {
    const val = getNestedValue(entityData, field);
    return val === expected || String(val) === String(expected);
  });
}

module.exports = { runAutomation, checkTriggers, resumeWaitingRuns };
