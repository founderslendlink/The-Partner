const { db } = require('../utils/supabase');
const { logger } = require('../utils/logger');
const { postToDiscord } = require('../discord/poster');

// These action types are ALWAYS blocked regardless of any rule configuration.
const HARDCODED_BLOCKED = new Set([
  'delete_record',
  'execute_transaction',
  'modify_permissions',
  'send_bulk_message',
  'access_ext_accounts',
  'disable_heartbeat',
]);

// V2: operator_mode maps to approval behavior overrides
// assisted      = everything approval_required (most conservative)
// semi_autonomous = follow permission_rules as configured
// autonomous    = auto-execute anything not hardcoded blocked (most permissive)
const OPERATOR_MODE_OVERRIDES = {
  assisted:       { default: 'approval_required', respect_rules: false },
  semi_autonomous: { default: null,               respect_rules: true  },
  autonomous:     { default: 'auto',              respect_rules: false },
};

/**
 * Check a single action against the permission rules.
 * V2: also applies operator_mode logic.
 * Returns: { allowed, rule, reason, operator_mode }
 */
async function checkPermission(businessId, actionType, payload = {}) {
  // Hard block — no database lookup needed, always enforced
  if (HARDCODED_BLOCKED.has(actionType)) {
    return {
      allowed: false,
      rule: 'blocked',
      reason: `Action type '${actionType}' is permanently blocked for safety.`,
      operator_mode: null,
    };
  }

  // Low confidence always requires approval regardless of mode
  if (payload._confidence !== undefined && payload._confidence < 0.6) {
    return {
      allowed: true,
      rule: 'approval_required',
      reason: `Low confidence score (${payload._confidence}) — escalated to approval.`,
      operator_mode: null,
    };
  }

  const supabase = db();

  // V2: Fetch operator_mode alongside permission rule in parallel
  const [ruleResult, bizResult] = await Promise.all([
    supabase.from('permission_rules').select('rule,conditions')
      .eq('business_id', businessId).eq('action_type', actionType).single(),
    supabase.from('businesses').select('operator_mode')
      .eq('id', businessId).single(),
  ]);

  const rule         = ruleResult.data;
  const operatorMode = bizResult.data?.operator_mode || 'assisted';
  const modeConfig   = OPERATOR_MODE_OVERRIDES[operatorMode] || OPERATOR_MODE_OVERRIDES.assisted;

  // V2: Apply operator_mode override (unless semi_autonomous respects rules)
  if (!modeConfig.respect_rules) {
    const overrideRule = modeConfig.default;

    if (overrideRule === 'auto') {
      return { allowed: true, rule: 'auto', reason: `operator_mode=${operatorMode} — auto-executing.`, operator_mode: operatorMode };
    }
    if (overrideRule === 'approval_required') {
      return { allowed: true, rule: 'approval_required', reason: `operator_mode=${operatorMode} — all actions require approval.`, operator_mode: operatorMode };
    }
  }

  // Semi-autonomous: respect the permission_rules table (V1 behavior preserved)
  if (!rule) {
    logger.warn(`No permission rule found for '${actionType}' — defaulting to approval_required`);
    return { allowed: true, rule: 'approval_required', reason: 'No rule configured.', operator_mode: operatorMode };
  }

  if (rule.rule === 'blocked') {
    return { allowed: false, rule: 'blocked', reason: `Action '${actionType}' is blocked.`, operator_mode: operatorMode };
  }

  // Evaluate conditions
  if (rule.conditions && Object.keys(rule.conditions).length > 0) {
    if (!evaluateConditions(rule.conditions, payload)) {
      return { allowed: true, rule: 'approval_required', reason: 'Condition threshold not met.', operator_mode: operatorMode };
    }
  }

  return { allowed: true, rule: rule.rule, reason: null, operator_mode: operatorMode };
}

/**
 * Process all proposed actions from an agent response.
 * V2: includes operator_mode in split results.
 */
async function processProposedActions(businessId, proposedActions, confidence = 1.0) {
  const auto = [];
  const needsApproval = [];
  const blocked = [];

  for (const action of proposedActions) {
    const payload = { ...action.payload, _confidence: confidence };
    const result = await checkPermission(businessId, action.action_type, payload);

    if (!result.allowed) {
      blocked.push({ ...action, block_reason: result.reason });
    } else if (result.rule === 'approval_required') {
      needsApproval.push({ ...action, approval_reason: result.reason, operator_mode: result.operator_mode });
    } else {
      auto.push({ ...action, operator_mode: result.operator_mode });
    }
  }

  if (needsApproval.length > 0) {
    await postToDiscord(businessId, 'approvals',
      `⏳ **${needsApproval.length} action(s) queued for approval**\n` +
      needsApproval.map(a => `• \`${a.action_type}\` — ${a.approval_reason || 'requires approval'}`).join('\n')
    ).catch(() => {});
  }

  if (blocked.length > 0) {
    await postToDiscord(businessId, 'approvals',
      `🚫 **${blocked.length} action(s) blocked**\n` +
      blocked.map(a => `• \`${a.action_type}\` — ${a.block_reason}`).join('\n')
    ).catch(() => {});
  }

  return { auto_actions: auto, approval_actions: needsApproval, blocked_actions: blocked };
}

function evaluateConditions(conditions, payload) {
  if (conditions.min_value && payload.value < conditions.min_value) return false;
  if (conditions.lead_score_min && payload.lead_score < conditions.lead_score_min) return false;
  if (conditions.template_only && !payload.is_template) return false;
  return true;
}

module.exports = { checkPermission, processProposedActions, HARDCODED_BLOCKED, OPERATOR_MODE_OVERRIDES };
