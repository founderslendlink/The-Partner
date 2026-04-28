const { db } = require('../utils/supabase');
const { logger } = require('../utils/logger');
const { writeAuditLog } = require('../utils/audit');
const { routeAndExecute } = require('../execution/router'); // V2: execution router

const POLL_INTERVAL = parseInt(process.env.ACTION_QUEUE_POLL_INTERVAL_MS || '10000');
const WORKER_ID     = `worker-${process.pid}`;
const RETRY_DELAYS  = [30_000, 120_000, 600_000];

let running = false;

function startQueueWorker() {
  if (running) return;
  running = true;
  logger.info(`Queue worker ${WORKER_ID} started. Poll interval: ${POLL_INTERVAL}ms`);
  poll();
}

async function poll() {
  if (!running) return;
  try {
    await processNextBatch();
  } catch (err) {
    logger.error('Queue worker poll error:', err.message);
  }
  setTimeout(poll, POLL_INTERVAL);
}

async function processNextBatch() {
  const supabase = db();
  const now = new Date().toISOString();

  const { data: actions, error } = await supabase
    .from('action_queue')
    .select('*')
    .eq('status', 'pending')
    .or(`scheduled_at.is.null,scheduled_at.lte.${now}`)
    .is('locked_at', null)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(5);

  if (error) { logger.error('Queue fetch error:', error.message); return; }
  if (!actions || actions.length === 0) return;

  for (const action of actions) {
    await processAction(action);
  }
}

async function processAction(action) {
  const supabase = db();

  // Optimistic lock
  const { data: locked, error: lockErr } = await supabase
    .from('action_queue')
    .update({ status: 'executing', locked_at: new Date().toISOString(), locked_by: WORKER_ID })
    .eq('id', action.id)
    .eq('status', 'pending')
    .is('locked_at', null)
    .select()
    .single();

  if (lockErr || !locked) return;

  // V2: Log the execution_target being used
  logger.info(`Executing action: ${action.action_type} [${action.id}] target=${action.execution_target || 'api'} category=${action.action_category || 'unknown'}`);

  try {
    // V2: Route through execution router instead of calling handlers directly
    const result = await routeAndExecute(action);

    await supabase.from('action_queue').update({
      status: 'completed',
      result,
      executed_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
    }).eq('id', action.id);

    await supabase.from('feedback_logs').insert({
      business_id: action.business_id,
      action_id:   action.id,
      result:      'completed_success',
      reward_score: 0.8,
      outcome_data: result || {},
    }).catch(() => {});

    await writeAuditLog({
      businessId:  action.business_id,
      actor:       'queue_worker',
      action:      `executed:${action.action_type}`,
      entityType:  action.payload?.entity_type,
      entityId:    action.payload?.entity_id,
      output:      { result, execution_target: action.execution_target || 'api' }, // V2: log target
    });

    logger.info(`Action completed: ${action.action_type} [${action.id}]`);

  } catch (err) {
    logger.error(`Action failed: ${action.action_type} [${action.id}]`, err.message);
    await handleFailure(action, err);
  }
}

async function handleFailure(action, err) {
  const supabase = db();
  const nextRetry = action.retry_count + 1;

  await supabase.from('error_logs').insert({
    business_id: action.business_id,
    action_id:   action.id,
    error_type:  classifyError(err),
    error_code:  err.code || null,
    message:     err.message,
    stack:       err.stack,
    context:     { action_type: action.action_type, execution_target: action.execution_target, retry: nextRetry },
  }).catch(() => {});

  if (nextRetry <= action.max_retries && shouldRetry(err)) {
    const delay   = RETRY_DELAYS[nextRetry - 1] || 600_000;
    const retryAt = new Date(Date.now() + delay).toISOString();

    // V2: If was browser, retry as api (downgrade)
    const retryTarget = action.execution_target === 'browser' ? 'api' : action.execution_target;

    await supabase.from('action_queue').update({
      status:           'pending',
      retry_count:      nextRetry,
      scheduled_at:     retryAt,
      locked_at:        null,
      locked_by:        null,
      execution_target: retryTarget,
    }).eq('id', action.id);

    logger.warn(`Action ${action.id} retry ${nextRetry} at ${retryAt} (target: ${retryTarget})`);
  } else {
    await supabase.from('action_queue').update({
      status: 'dead_letter', locked_at: null, locked_by: null,
    }).eq('id', action.id);

    await supabase.from('feedback_logs').insert({
      business_id: action.business_id, action_id: action.id,
      result: 'completed_failure', reward_score: -0.8,
    }).catch(() => {});

    const { sendTelegramAlert } = require('../telegram/sender');
    await sendTelegramAlert(action.business_id,
      `⚠️ Action permanently failed: *${action.action_type}*\nError: ${err.message}\nTarget: ${action.execution_target || 'api'}`
    ).catch(() => {});

    logger.error(`Action ${action.id} → dead_letter`);
  }
}

function shouldRetry(err) {
  if (err.status === 401 || err.status === 403) return false;
  if (err.message?.includes('No handler') && err.message?.includes('No system handler')) return false;
  return true;
}

function classifyError(err) {
  if (err.status === 429)                                       return 'rate_limit';
  if (err.status === 401 || err.status === 403)                 return 'auth_error';
  if (err.status >= 500)                                        return 'server_error';
  if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') return 'network_error';
  if (err.message?.includes('Playwright'))                      return 'browser_error';
  return 'unknown_error';
}

module.exports = { startQueueWorker };
