/**
 * TASK DECOMPOSITION
 *
 * Preprocessing step inserted BEFORE CEO agent reasoning.
 * Detects complex multi-step tasks and breaks them into
 * ordered subtasks, each with their own execution context.
 *
 * Flow (V2):
 *   User Input → [NEW] Decompose → Subtasks → CEO Agent per subtask → Execute
 *
 * Simple tasks pass through unchanged (no decomposition overhead).
 */

const { callAI } = require('../utils/ai');
const { db } = require('../utils/supabase');
const { logger } = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

// Complexity signals that trigger decomposition
const COMPLEXITY_SIGNALS = [
  /and then/i, /first.*then/i, /step by step/i, /multiple/i,
  /for each/i, /all of my/i, /entire/i, /full campaign/i,
  /prepare for/i, /get ready/i, /set up/i, /onboard/i,
  /research.*and.*contact/i, /follow up.*with all/i,
];

const DECOMPOSITION_PROMPT = `You are a task decomposition engine for an AI business operating system.

Your job: take a complex user request and break it into ordered subtasks.

Rules:
- Each subtask must be independently executable
- Order matters — dependencies must be respected
- Keep subtasks focused (one action per subtask)
- If the task is simple (single action), return it as-is with one subtask
- Maximum 6 subtasks per decomposition

You MUST respond with valid JSON in a markdown code block:

\`\`\`json
{
  "is_complex": true,
  "reasoning": "Why this needs decomposition (or why it doesn't)",
  "subtasks": [
    {
      "id": "st_1",
      "title": "Short title",
      "description": "What exactly to do",
      "agent": "sales_pipeline",
      "depends_on": [],
      "action_category": "communication",
      "execution_target": "api"
    }
  ]
}
\`\`\`

Agent options: ceo, sales_pipeline, revenue_strategy, product_marketing, operations_memory
Action categories: communication, data_update, research, content_creation, system_operation, external_execution
Execution targets: api, browser, system`;

/**
 * Determine if a task needs decomposition.
 * Fast heuristic check — no AI call needed for simple tasks.
 */
function needsDecomposition(task) {
  if (task.length < 40) return false;
  return COMPLEXITY_SIGNALS.some(sig => sig.test(task));
}

/**
 * Main decomposition function.
 * Called by the orchestrator before CEO agent.
 *
 * Returns: { decompositionId, subtasks, isComplex }
 */
async function decomposeTask({ businessId, task, sessionId, context }) {
  // Fast path: simple tasks skip decomposition entirely
  if (!needsDecomposition(task)) {
    return {
      decompositionId: null,
      isComplex: false,
      subtasks: [{
        id: 'st_1',
        title: task.slice(0, 60),
        description: task,
        agent: 'ceo',
        depends_on: [],
        action_category: classifyTaskCategory(task),
        execution_target: 'api',
      }],
    };
  }

  logger.info(`Decomposing complex task: "${task.slice(0, 60)}..."`);

  const contextHint = context?.system_state
    ? `Current mode: ${context.system_state.current_mode}. Pipeline: ${context.crm_snapshot?.open_opportunities?.length || 0} deals.`
    : '';

  const output = await callAI({
    systemPrompt: DECOMPOSITION_PROMPT,
    userMessage: `TASK: ${task}\n\nCONTEXT: ${contextHint}`,
    maxTokens: 1024,
  });

  const subtasks = output.subtasks || [{
    id: 'st_1',
    title: task.slice(0, 60),
    description: task,
    agent: 'ceo',
    depends_on: [],
    action_category: 'system_operation',
    execution_target: 'api',
  }];

  // Persist decomposition record
  const decompositionId = uuidv4();
  const supabase = db();
  await supabase.from('task_decompositions').insert({
    id:             decompositionId,
    business_id:    businessId,
    session_id:     sessionId || null,
    original_task:  task,
    subtasks:       subtasks,
    status:         'in_progress',
    agent:          'ceo',
    total_subtasks: subtasks.length,
    done_subtasks:  0,
  }).catch(() => {});

  return {
    decompositionId,
    isComplex: output.is_complex !== false,
    subtasks,
    reasoning: output.reasoning,
  };
}

/**
 * Mark a subtask as complete and update decomposition progress.
 */
async function markSubtaskComplete(decompositionId, subtaskId) {
  if (!decompositionId) return;
  const supabase = db();

  const { data } = await supabase
    .from('task_decompositions')
    .select('done_subtasks,total_subtasks,subtasks')
    .eq('id', decompositionId)
    .single();

  if (!data) return;

  const newDone = data.done_subtasks + 1;
  const isComplete = newDone >= data.total_subtasks;

  await supabase.from('task_decompositions').update({
    done_subtasks: newDone,
    status: isComplete ? 'completed' : 'in_progress',
  }).eq('id', decompositionId).catch(() => {});
}

/**
 * Simple category classifier for single tasks (no AI needed).
 */
function classifyTaskCategory(task) {
  const t = task.toLowerCase();
  if (/send|message|email|contact|reply|respond/.test(t)) return 'communication';
  if (/research|find|look up|search|check/.test(t)) return 'research';
  if (/write|create|draft|generate|content/.test(t)) return 'content_creation';
  if (/update|change|set|mark|move|advance/.test(t)) return 'data_update';
  if (/run|execute|trigger|start|launch/.test(t)) return 'system_operation';
  return 'system_operation';
}

module.exports = { decomposeTask, markSubtaskComplete, needsDecomposition };
