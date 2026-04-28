/**
 * TOOL REGISTRY
 *
 * Central registry for all capabilities available to agents.
 * Agents SELECT tools dynamically based on task requirements.
 * Execution layer routes to api/browser/system based on tool type.
 *
 * NEW MODULE — integrates into existing agent + execution flow.
 */

const { db } = require('../utils/supabase');
const { logger } = require('../utils/logger');

/**
 * Get all enabled tools, optionally filtered by execution_type or permission.
 */
async function getAvailableTools({ executionType, requiredPermission } = {}) {
  const supabase = db();
  let query = supabase
    .from('tools_registry')
    .select('*')
    .eq('enabled', true)
    .order('success_rate', { ascending: false });

  if (executionType) query = query.eq('execution_type', executionType);

  const { data, error } = await query;
  if (error) {
    logger.error('Failed to fetch tools registry:', error.message);
    return [];
  }

  if (requiredPermission) {
    return (data || []).filter(t => t.permissions.includes(requiredPermission));
  }

  return data || [];
}

/**
 * Get a single tool by name.
 */
async function getTool(toolName) {
  const supabase = db();
  const { data } = await supabase
    .from('tools_registry')
    .select('*')
    .eq('tool_name', toolName)
    .eq('enabled', true)
    .single();
  return data;
}

/**
 * Select the best tool for an action type.
 * Used by execution router to determine API vs browser vs system.
 *
 * Decision logic:
 * 1. Check if a specific tool_name is in the action payload (explicit)
 * 2. Otherwise match by permission/action_type
 * 3. Prefer API over browser (faster, cheaper, more reliable)
 * 4. Fall back to browser if API tool unavailable or failed recently
 */
async function selectToolForAction(actionType, payload = {}) {
  // Explicit tool override in payload
  if (payload.tool_name) {
    const tool = await getTool(payload.tool_name);
    if (tool) return tool;
  }

  // Map action types to required permissions
  const permissionMap = {
    send_message:       'send_message',
    send_email:         'send_email',
    book_meeting:       'book_meeting',
    draft_message:      'content_creation',
    research_lead:      'research',
    scrape_data:        'research',
    fill_form:          'external_execution',
    update_lead_score:  'data_update',
    create_task:        'data_update',
    generate_content:   'content_creation',
    post_discord_alert: 'send_message',
  };

  const requiredPermission = permissionMap[actionType];
  if (!requiredPermission) return null;

  const tools = await getAvailableTools({ requiredPermission });
  if (tools.length === 0) return null;

  // Prefer API tools, then system, then browser
  const byType = { api: [], system: [], browser: [] };
  for (const t of tools) byType[t.execution_type]?.push(t);

  return byType.api[0] || byType.system[0] || byType.browser[0] || null;
}

/**
 * Get tools formatted for inclusion in an agent's system prompt.
 * Agents use this to select the right tool for each proposed action.
 */
async function getToolsManifestForAgent() {
  const tools = await getAvailableTools();
  return tools.map(t => ({
    name:           t.tool_name,
    description:    t.description,
    execution_type: t.execution_type,
    input_schema:   t.input_schema,
  }));
}

/**
 * Update tool stats after execution (success rate, latency, last used).
 */
async function recordToolUsage(toolName, { success, latencyMs }) {
  const supabase = db();
  const tool = await getTool(toolName);
  if (!tool) return;

  // Rolling average success rate (simple exponential moving average)
  const alpha = 0.1;
  const newRate = tool.success_rate * (1 - alpha) + (success ? 1 : 0) * alpha;

  await supabase
    .from('tools_registry')
    .update({
      success_rate: newRate,
      avg_latency_ms: latencyMs || tool.avg_latency_ms,
      last_used_at: new Date().toISOString(),
    })
    .eq('tool_name', toolName)
    .catch(() => {});
}

module.exports = { getAvailableTools, getTool, selectToolForAction, getToolsManifestForAgent, recordToolUsage };
