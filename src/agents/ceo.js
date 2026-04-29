/**
 * CEO AGENT — V2 UPGRADE
 *
 * Changes from V1:
 * - Receives environment context (time, workload, urgency)
 * - Includes tools manifest so it can select execution targets
 * - Returns reasoning_summary + explanation (explainability)
 * - Decomposition awareness: knows if it's handling a subtask
 *
 * V1 functions (runCEOAgent, buildContextSummary, logDecision) preserved.
 * New: enriched system prompt, explainability fields in output, tool selection.
 */

const { callAI } = require('../utils/ai');
const { db } = require('../utils/supabase');
const { getToolsManifestForAgent } = require('../tools/registry');

const BASE_SYSTEM_PROMPT = `You are The Partner — the CEO agent of an AI business operating system.
You are the master orchestrator. You receive every user input first and decide how to respond.

Your personality: direct, sharp, businesslike. You communicate like a smart operations partner, not a chatbot.

Your responsibilities:
- Understand what the operator needs
- Decide whether to handle it yourself or delegate to a specialist agent
- Synthesize information into clear, actionable responses
- Select the right TOOL for each proposed action (see AVAILABLE TOOLS below)
- Always know the state of the business from the context you receive

CRITICAL RULES:
1. You NEVER take actions on the outside world directly. You propose them.
2. You NEVER delete data. Ever.
3. You NEVER bypass the permission system.
4. Low confidence = propose but flag for approval.
5. Always include reasoning_summary and explanation in output (explainability requirement).
6. Use environment.scheduling_advice to determine WHEN to schedule actions.

SYSTEM MODES:
- booking_mode: Lead response speed, meeting conversion priority
- product_push_mode: Content and campaign focus
- balanced_mode: Normal operations (default)
- admin_mode: Maintenance only — no outbound actions
- strategy_mode: Analysis and planning
- onboarding_mode: Observe and learn, do not act

OPERATOR MODES (controls how much autonomy you have):
- assisted: everything goes to approval — always set approval_required
- semi_autonomous: follow permission_rules — propose actions normally
- autonomous: auto-execute everything safe — prefer execution over asking

ACTION CATEGORIES (you must set action_category on every proposed action):
- communication: sending messages, emails, notifications
- data_update: changing CRM records, task status, pipeline stages
- research: finding information, searching, web lookups
- content_creation: writing copy, campaigns, reports
- system_operation: internal workflow triggers, mode switches
- external_execution: browser automation, form fills, file operations

EXECUTION TARGETS (you must set execution_target on every proposed action):
- api: standard API call (fast, reliable — prefer this)
- browser: web automation required (use when no API exists)
- system: internal Supabase operation

SPECIALIST AGENTS — delegate to these when appropriate:
- sales_pipeline:     lead qualification, pipeline movement, follow-ups, deal recovery
- revenue_strategy:   financial forecasting, pricing, revenue reporting
- product_marketing:  content creation, social media posts, campaigns, email copy
- operations_memory:  meeting notes, task management, memory consolidation
- referral:           referral program, affiliate management, commission tracking,
                      identifying referral-ready clients, drafting referral request messages

Delegate to the referral agent when:
- A deal is marked as won and no referral request has been sent
- The operator asks about referrals, affiliates, or commissions
- The heartbeat fires a referral.opportunity or referral.commission event
- A client has been happy for 60+ days with no referral sent

You MUST respond with a valid JSON object in a markdown code block:

\`\`\`json
{
  "summary": "Human-readable response sent to operator.",
  "recommendation": "Internal strategic note.",
  "reasoning_summary": "1-2 sentence explanation of WHY you made these decisions.",
  "explanation": "Step-by-step logic: what signals you saw, what you considered, why you chose this path.",
  "confidence": 0.85,
  "proposed_actions": [
    {
      "action_type": "draft_message",
      "action_category": "communication",
      "execution_target": "api",
      "tool_name": "send_telegram_message",
      "payload": { "lead_id": "uuid", "message": "Hi Sarah..." },
      "priority": 7
    }
  ],
  "memory_updates": [
    {
      "type": "insight",
      "content": "Operator prefers concise briefings.",
      "importance": 6,
      "source": "ceo_agent"
    }
  ]
}
\`\`\``;

async function runCEOAgent({ task, context, sessionId, decompositionContext }) {
  // V2: Fetch tools manifest to include in prompt
  const toolsManifest = await getToolsManifestForAgent();
  const toolsSection = toolsManifest.length > 0
    ? `\n\nAVAILABLE TOOLS:\n${toolsManifest.map(t =>
        `- ${t.name} (${t.execution_type}): ${t.description}`
      ).join('\n')}`
    : '';

  const systemPrompt = BASE_SYSTEM_PROMPT + toolsSection;
  const contextSummary = buildContextSummary(context, decompositionContext);
  const userMessage = `TASK: ${task}\n\nCURRENT CONTEXT:\n${contextSummary}`;

  const output = await callAI({ systemPrompt, userMessage, maxTokens: 2500 });

  // V2: Log decision with new explainability fields
  await logDecision({
    businessId:         context.business_id,
    agent:              'ceo',
    sessionId,
    task,
    reasoning:          output.recommendation || '',
    reasoningSummary:   output.reasoning_summary || '',
    explanation:        output.explanation || '',
    confidence:         output.confidence,
    toolSelected:       output.proposed_actions?.[0]?.tool_name || null,
    proposedActionsCount: output.proposed_actions?.length || 0,
    decompositionId:    decompositionContext?.decompositionId || null,
  });

  return output;
}

// V2: enriched context summary includes environment data
function buildContextSummary(context, decompositionContext) {
  const parts = [];

  // V2: Environment context (NEW)
  if (context.environment) {
    const env = context.environment;
    parts.push(`TIME: ${env.local_time} ${env.day_of_week} | Timezone: ${env.timezone}`);
    parts.push(`WORKLOAD: ${env.workload_level} | URGENCY: ${env.urgency}`);
    parts.push(`SCHEDULING: ${env.scheduling_advice}`);
    parts.push(`PENDING APPROVALS: ${env.pending_approvals} | OVERDUE TASKS: ${env.overdue_tasks}`);
  }

  // V2: Decomposition context (NEW)
  if (decompositionContext?.isComplex) {
    parts.push(`\nDECOMPOSITION: Part of a multi-step task (${decompositionContext.subtasks?.length} subtasks total)`);
    parts.push(`REASONING: ${decompositionContext.reasoning || ''}`);
  }

  if (context.system_state) {
    parts.push(`MODE: ${context.system_state.current_mode}`);
  }

  if (context.crm_snapshot?.recent_leads?.length > 0) {
    const hot = context.crm_snapshot.recent_leads.filter(l => l.status === 'new' || l.status === 'contacted');
    parts.push(`ACTIVE LEADS: ${context.crm_snapshot.recent_leads.length} total, ${hot.length} need attention`);
  }

  if (context.crm_snapshot?.open_opportunities?.length > 0) {
    const total = context.crm_snapshot.open_opportunities.reduce((s, o) => s + parseFloat(o.value || 0), 0);
    parts.push(`PIPELINE: ${context.crm_snapshot.open_opportunities.length} deals, $${total.toLocaleString()} total value`);
  }

  if (context.crm_snapshot?.open_tasks?.length > 0) {
    const overdue = context.crm_snapshot.open_tasks.filter(t => t.status === 'overdue');
    parts.push(`TASKS: ${context.crm_snapshot.open_tasks.length} open, ${overdue.length} overdue`);
  }

  if (context.memory?.length > 0) {
    parts.push(`\nRELEVANT MEMORY (${context.memory.length} entries):`);
    context.memory.slice(0, 6).forEach(m => parts.push(`  [${m.type}] ${m.content}`));
  }

  if (context.recent_decisions?.length > 0) {
    parts.push(`\nRECENT DECISIONS:`);
    context.recent_decisions.forEach(d => parts.push(`  [${d.agent}] ${d.task} → confidence ${d.confidence}`));
  }

  if (context.metrics && Object.keys(context.metrics).length > 0) {
    parts.push(`\nMETRICS: ${JSON.stringify(context.metrics)}`);
  }

  return parts.join('\n');
}

async function logDecision({ businessId, agent, sessionId, task, reasoning, reasoningSummary, explanation, confidence, toolSelected, proposedActionsCount, decompositionId }) {
  const supabase = db();
  try {
    await supabase.from('decision_logs').insert({
      business_id:            businessId,
      agent,
      session_id:             sessionId || null,
      task,
      reasoning,
      reasoning_summary:      reasoningSummary,  // V2
      explanation:            explanation,        // V2
      confidence,
      tool_selected:          toolSelected,       // V2
      proposed_actions_count: proposedActionsCount,
      decomposition_id:       decompositionId,    // V2
    });
  } catch (e) {}
}

module.exports = { runCEOAgent };
