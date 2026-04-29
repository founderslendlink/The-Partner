/**
 * EXECUTION ROUTER
 *
 * NEW module that sits between the queue worker and handlers.
 * Determines the correct execution target for each action,
 * then routes to the appropriate executor.
 *
 * V1 flow: action → handlers[action_type](payload)
 * V2 flow: action → router → [api|browser|system] executor → handlers
 *
 * Fallback logic:
 *   API fails → check if browser fallback exists → try browser executor
 *   Browser fails → dead letter with full trace
 */

const { logger } = require('../utils/logger');
const { selectToolForAction, recordToolUsage } = require('../tools/registry');
const { db } = require('../utils/supabase');

// API executor — calls existing handlers (V1 behavior preserved)
const apiHandlers = require('../queue/handlers');

/**
 * Route and execute a single action.
 * Called by the queue worker instead of directly calling handlers.
 *
 * @returns result object
 */
async function routeAndExecute(action) {
  const { action_type, payload, business_id, execution_target, tool_name } = action;

  // Determine execution target:
  // 1. Use explicit execution_target on the action if set
  // 2. Look up via tool registry
  // 3. Default to 'api'
  let target = execution_target || 'api';
  let tool = null;

  if (tool_name) {
    tool = await selectToolForAction(action_type, { ...payload, tool_name });
    if (tool) target = tool.execution_type;
  } else if (target === 'api') {
    // Auto-select best tool
    tool = await selectToolForAction(action_type, payload);
    if (tool) target = tool.execution_type;
  }

  logger.info(`Routing action ${action_type} [${action.id}] → target=${target} tool=${tool?.tool_name || 'handler'}`);

  const start = Date.now();
  let result;
  let success = true;

  try {
    switch (target) {
      case 'browser':
        result = await executeBrowser(action, tool);
        break;
      case 'system':
        result = await executeSystem(action);
        break;
      case 'api':
      default:
        result = await executeAPI(action);
        break;
    }
  } catch (err) {
    success = false;

    // Fallback: if API failed and a browser fallback exists, try it
    if (target === 'api' && tool?.fallback_tool) {
      logger.warn(`API execution failed for ${action_type}, trying browser fallback: ${tool.fallback_tool}`);
      try {
        const fallbackTool = await selectToolForAction(action_type, { tool_name: tool.fallback_tool });
        if (fallbackTool) {
          result = await executeBrowser({ ...action, tool_name: tool.fallback_tool }, fallbackTool);
          success = true;
          // Update action record to reflect actual execution target
          try {
            await db().from('action_queue')
              .update({ execution_target: 'browser' })
              .eq('id', action.id);
          } catch (e) {}
        }
      } catch (fallbackErr) {
        logger.error(`Fallback also failed: ${fallbackErr.message}`);
        throw fallbackErr; // Re-throw original + fallback both failed
      }
    } else {
      throw err;
    }
  } finally {
    const latencyMs = Date.now() - start;
    if (tool) {
      await recordToolUsage(tool.tool_name, { success, latencyMs });
    }
  }

  return result;
}

/**
 * API executor — routes to existing handler functions.
 * This preserves ALL V1 behavior exactly.
 */
async function executeAPI(action) {
  const handler = apiHandlers[action.action_type];
  if (!handler) {
    throw new Error(`No API handler registered for action_type: ${action.action_type}`);
  }
  return handler(action.payload, action.business_id);
}

/**
 * Browser executor — uses Playwright for UI automation.
 * Requires playwright to be installed: npm install playwright
 */
async function executeBrowser(action, tool) {
  const supabase = db();

  // Create browser session record
  const { data: session } = await supabase
    .from('browser_sessions')
    .insert({
      business_id:  action.business_id,
      action_id:    action.id,
      status:       'running',
      target_url:   action.payload?.url || null,
      steps:        action.payload?.steps || [],
      started_at:   new Date().toISOString(),
    })
    .select()
    .single();

  const sessionId = session?.id;

  try {
    // Attempt to load Playwright — graceful degradation if not installed
    let playwright;
    try {
      playwright = require('playwright');
    } catch {
      throw new Error(
        'Playwright not installed. Run: npm install playwright && npx playwright install chromium\n' +
        'Browser automation requires this dependency.'
      );
    }

    const browser = await playwright.chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(30000);

    let result = {};

    // Execute steps from payload
    const steps = action.payload?.steps || [];
    const completedSteps = [];

    for (const step of steps) {
      logger.debug(`Browser step: ${step.action} — ${step.target || step.url || ''}`);

      switch (step.action) {
        case 'navigate':
          await page.goto(step.url, { waitUntil: 'networkidle' });
          completedSteps.push({ ...step, status: 'done' });
          break;

        case 'click':
          await page.click(step.selector);
          completedSteps.push({ ...step, status: 'done' });
          break;

        case 'type':
          await page.fill(step.selector, step.value);
          completedSteps.push({ ...step, status: 'done' });
          break;

        case 'select':
          await page.selectOption(step.selector, step.value);
          completedSteps.push({ ...step, status: 'done' });
          break;

        case 'submit':
          await page.click(step.selector || 'button[type="submit"]');
          await page.waitForLoadState('networkidle');
          completedSteps.push({ ...step, status: 'done' });
          break;

        case 'extract':
          const content = await page.textContent(step.selector);
          result[step.key || 'content'] = content;
          completedSteps.push({ ...step, status: 'done', extracted: content?.slice(0, 200) });
          break;

        case 'screenshot':
          const screenshotPath = `/tmp/screenshot_${Date.now()}.png`;
          await page.screenshot({ path: screenshotPath, fullPage: true });
          result.screenshot_path = screenshotPath;
          completedSteps.push({ ...step, status: 'done', path: screenshotPath });
          break;

        case 'wait':
          await page.waitForTimeout(step.ms || 1000);
          completedSteps.push({ ...step, status: 'done' });
          break;

        case 'wait_for_selector':
          await page.waitForSelector(step.selector);
          completedSteps.push({ ...step, status: 'done' });
          break;

        default:
          logger.warn(`Unknown browser step action: ${step.action}`);
          completedSteps.push({ ...step, status: 'skipped' });
      }

      // Update session with progress
      if (sessionId) {
        try {
          await supabase.from('browser_sessions')
            .update({ steps: completedSteps })
            .eq('id', sessionId);
        } catch (e) {}
      }
    }

    await browser.close();

    // Mark session complete
    if (sessionId) {
      try {
        await supabase.from('browser_sessions').update({
          status: 'completed',
          result,
          completed_at: new Date().toISOString(),
        }).eq('id', sessionId);
      } catch (e) {}
    }

    return { ...result, browser_session_id: sessionId, steps_completed: completedSteps.length };

  } catch (err) {
    if (sessionId) {
      try {
        await supabase.from('browser_sessions').update({
          status: 'failed',
          error: err.message,
          completed_at: new Date().toISOString(),
        }).eq('id', sessionId);
      } catch (e) {}
    }
    throw err;
  }
}

/**
 * System executor — direct Supabase operations, internal logic.
 */
async function executeSystem(action) {
  const handler = apiHandlers[action.action_type];
  if (handler) {
    return handler(action.payload, action.business_id);
  }

  // Generic system operations
  switch (action.action_type) {
    case 'query_supabase': {
      const supabase = db();
      const { data } = await supabase
        .from(action.payload.table)
        .select(action.payload.select || '*')
        .match(action.payload.filters || {});
      return { rows: data || [] };
    }
    case 'update_supabase_record': {
      const supabase = db();
      await supabase
        .from(action.payload.table)
        .update(action.payload.data)
        .eq('id', action.payload.id);
      return { updated: true };
    }
    default:
      throw new Error(`No system handler for: ${action.action_type}`);
  }
}

module.exports = { routeAndExecute };
