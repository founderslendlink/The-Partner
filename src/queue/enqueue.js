/**
 * ACTION QUEUE — V2 UPGRADE
 *
 * Changes from V1:
 * - enqueue() now accepts action_category and execution_target
 * - Both fields are written to action_queue table (new V2 columns)
 * - approveAction/rejectAction preserved unchanged
 */

const { db } = require('../utils/supabase');
const { logger } = require('../utils/logger');

/**
 * Enqueue a single action.
 * V2: adds action_category, execution_target, tool_name, explanation fields.
 */
async function enqueue(businessId, {
  action_type,
  action_category  = null,   // V2
  execution_target = 'api',  // V2
  tool_name        = null,   // V2
  explanation      = null,   // V2
  payload          = {},
  priority         = 5,
  status           = 'pending',
  scheduled_at     = null,
  approved_by      = null,
  subtask_of       = null,   // V2: parent action ID
  decomposition_id = null,   // V2
}) {
  const supabase = db();
  const { data, error } = await supabase
    .from('action_queue')
    .insert({
      business_id:      businessId,
      action_type,
      action_category,   // V2
      execution_target,  // V2
      tool_name,         // V2
      explanation,       // V2
      status,
      payload,
      priority,
      scheduled_at,
      approved_by,
      subtask_of,        // V2
      decomposition_id,  // V2
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to enqueue action:', error.message, { action_type });
    throw error;
  }

  logger.debug(`Enqueued: ${action_type} [${data.id}] status=${status} target=${execution_target} category=${action_category || 'none'}`);
  return data;
}

/**
 * Enqueue multiple actions. Preserves V1 interface.
 */
async function enqueueMany(businessId, actions) {
  const results = [];
  for (const action of actions) {
    results.push(await enqueue(businessId, action));
  }
  return results;
}

/**
 * Approve an action. Unchanged from V1.
 */
async function approveAction(actionId, approvedBy = 'operator') {
  const supabase = db();
  const { data, error } = await supabase
    .from('action_queue')
    .update({ status: 'pending', approved_by: approvedBy })
    .eq('id', actionId)
    .eq('status', 'approval_required')
    .select()
    .single();

  if (error) throw error;

  await supabase.from('feedback_logs').insert({
    business_id: data.business_id,
    action_id:   actionId,
    result:      'approved',
    reward_score: 0.5,
  }).catch(() => {});

  return data;
}

/**
 * Reject an action. Unchanged from V1.
 */
async function rejectAction(actionId, reason = '') {
  const supabase = db();
  const { data, error } = await supabase
    .from('action_queue')
    .update({ status: 'rejected', rejection_reason: reason })
    .eq('id', actionId)
    .select()
    .single();

  if (error) throw error;

  await supabase.from('feedback_logs').insert({
    business_id:  data.business_id,
    action_id:    actionId,
    result:       'rejected',
    reward_score: -0.5,
    reason,
  }).catch(() => {});

  return data;
}

module.exports = { enqueue, enqueueMany, approveAction, rejectAction };
