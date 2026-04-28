const { db } = require('../utils/supabase');
const { createEmbedding } = require('../utils/ai');
const { logger } = require('../utils/logger');
const { buildEnvironmentContext } = require('./environment'); // V2: environment context

const TIER1_TOKEN_BUDGET  = 800;
const TIER2_TOKEN_BUDGET  = 1000;
const TIER3_TOKEN_BUDGET  = 600;
const SYSTEM_STATE_BUDGET = 400;
const DECISIONS_BUDGET    = 600;
const METRICS_BUDGET      = 200;

/**
 * Build the full context object for an AI inference call.
 *
 * @param {Object} opts
 * @param {string} opts.businessId
 * @param {string} opts.userInput       - Current user message or task description
 * @param {string} [opts.entityType]    - 'lead' | 'opportunity' | 'task' (optional)
 * @param {string} [opts.entityId]      - UUID of the entity in focus (optional)
 * @param {string} [opts.sessionId]     - Current session UUID
 * @returns {Object} context_object
 */
async function buildContext({ businessId, userInput, entityType, entityId, sessionId }) {
  const [crmSnapshot, memoryTier2, systemState, recentDecisions, metricsSnap, environment] =
    await Promise.all([
      fetchTier1(businessId, entityType, entityId),
      fetchTier2(businessId, entityType, entityId),
      fetchSystemState(businessId),
      fetchRecentDecisions(businessId),
      fetchMetrics(businessId),
      buildEnvironmentContext(businessId, null), // V2: environment + time context
    ]);

  // Semantic search runs after other fetches (needs embedding)
  const memoryTier3 = await fetchTier3(businessId, userInput, memoryTier2.map(m => m.id));

  const context = {
    business_id:      businessId,
    session_id:       sessionId || null,
    crm_snapshot:     crmSnapshot,
    memory:           [...memoryTier2, ...memoryTier3],
    system_state:     systemState,
    recent_decisions: recentDecisions,
    metrics:          metricsSnap,
    environment:      environment,   // V2: time, workload, urgency, scheduling_advice
    built_at:         new Date().toISOString(),
  };

  return context;
}

// ── Tier 1: Structured CRM ────────────────────────────────────────────────────
async function fetchTier1(businessId, entityType, entityId) {
  const supabase = db();
  const snapshot = {};

  // Always fetch: recent leads summary
  const { data: leads } = await supabase
    .from('leads')
    .select('id,name,email,status,lead_score,last_contacted_at,source,created_at')
    .eq('business_id', businessId)
    .not('status', 'in', '("won","lost")')
    .order('created_at', { ascending: false })
    .limit(10);

  snapshot.recent_leads = leads || [];

  // Always fetch: open opportunities
  const { data: opps } = await supabase
    .from('opportunities')
    .select('id,name,stage,value,close_date,stalled_at,lead_id')
    .eq('business_id', businessId)
    .not('stage', 'in', '("won","lost")')
    .order('value', { ascending: false })
    .limit(10);

  snapshot.open_opportunities = opps || [];

  // Always fetch: overdue and high-priority tasks
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id,title,status,priority,due_at,assigned_agent,related_entity_type,related_entity_id')
    .eq('business_id', businessId)
    .in('status', ['pending', 'in_progress', 'overdue'])
    .order('priority', { ascending: false })
    .limit(10);

  snapshot.open_tasks = tasks || [];

  // Active products
  const { data: products } = await supabase
    .from('products')
    .select('id,name,price,conversion_rate,promotion_active')
    .eq('business_id', businessId)
    .eq('active', true);

  snapshot.products = products || [];

  // If focused on a specific entity, fetch its details + recent interactions
  if (entityType === 'lead' && entityId) {
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', entityId)
      .single();
    snapshot.focused_lead = lead;

    const { data: interactions } = await supabase
      .from('interactions')
      .select('channel,direction,content,sentiment,created_at')
      .eq('lead_id', entityId)
      .order('created_at', { ascending: false })
      .limit(5);
    snapshot.recent_interactions = interactions || [];

    const { data: leadOpps } = await supabase
      .from('opportunities')
      .select('*')
      .eq('lead_id', entityId);
    snapshot.lead_opportunities = leadOpps || [];
  }

  if (entityType === 'opportunity' && entityId) {
    const { data: opp } = await supabase
      .from('opportunities')
      .select('*, leads(name,email,phone)')
      .eq('id', entityId)
      .single();
    snapshot.focused_opportunity = opp;
  }

  return snapshot;
}

// ── Tier 2: Contextual Memory ─────────────────────────────────────────────────
async function fetchTier2(businessId, entityType, entityId) {
  const supabase = db();

  let query = supabase
    .from('memory_entries')
    .select('id,type,content,importance,source,created_at')
    .eq('business_id', businessId)
    .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
    .order('importance', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(15);

  // If entity focused, also pull entity-specific memories via tags
  if (entityType && entityId) {
    const { data: taggedIds } = await supabase
      .from('memory_tags')
      .select('memory_id')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId);

    if (taggedIds && taggedIds.length > 0) {
      const ids = taggedIds.map(t => t.memory_id);
      const { data: entityMemories } = await supabase
        .from('memory_entries')
        .select('id,type,content,importance,source,created_at')
        .in('id', ids)
        .order('importance', { ascending: false });

      if (entityMemories) {
        return entityMemories.slice(0, 8);
      }
    }
  }

  const { data: memories } = await query;
  return (memories || []).slice(0, 8);
}

// ── Tier 3: Semantic Vector Search ───────────────────────────────────────────
async function fetchTier3(businessId, userInput, alreadyIncludedIds = []) {
  if (!userInput || userInput.length < 10) return [];

  try {
    const embedding = await createEmbedding(userInput);
    const supabase = db();

    const { data: results, error } = await supabase.rpc('search_memories', {
      p_business_id: businessId,
      p_embedding:   embedding,
      p_threshold:   parseFloat(process.env.MEMORY_SIMILARITY_THRESHOLD || '0.75'),
      p_limit:       parseInt(process.env.MEMORY_TOP_K || '5'),
    });

    if (error) {
      logger.warn('Semantic search error:', error.message);
      return [];
    }

    // Deduplicate against Tier 2 results
    return (results || [])
      .filter(r => !alreadyIncludedIds.includes(r.id))
      .map(r => ({ ...r, source: `semantic_search (similarity: ${r.similarity?.toFixed(2)})` }));
  } catch (err) {
    logger.warn('Tier 3 memory search failed (non-fatal):', err.message);
    return [];
  }
}

// ── System State ──────────────────────────────────────────────────────────────
async function fetchSystemState(businessId) {
  const supabase = db();

  const { data: business } = await supabase
    .from('businesses')
    .select('mode,settings,timezone')
    .eq('id', businessId)
    .single();

  // Count pending approvals
  const { count: pendingApprovals } = await supabase
    .from('action_queue')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('status', 'approval_required');

  // Count action queue depth
  const { count: queueDepth } = await supabase
    .from('action_queue')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('status', 'pending');

  // Last heartbeat
  const { data: lastHeartbeat } = await supabase
    .from('heartbeat_checks')
    .select('check_type,violations_found,last_run_at')
    .eq('business_id', businessId)
    .order('last_run_at', { ascending: false })
    .limit(3);

  return {
    current_mode:     business?.mode || 'balanced_mode',
    settings:         business?.settings || {},
    timezone:         business?.timezone || 'America/Chicago',
    pending_approvals: pendingApprovals || 0,
    queue_depth:      queueDepth || 0,
    last_heartbeats:  lastHeartbeat || [],
  };
}

// ── Recent Decisions ──────────────────────────────────────────────────────────
async function fetchRecentDecisions(businessId) {
  const supabase = db();
  const { data } = await supabase
    .from('decision_logs')
    .select('agent,task,reasoning,confidence,outcome,created_at')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(3);
  return data || [];
}

// ── Metrics Snapshot ──────────────────────────────────────────────────────────
async function fetchMetrics(businessId) {
  const supabase = db();
  const { data } = await supabase
    .from('metric_snapshots')
    .select('snapshot,snapshot_at')
    .eq('business_id', businessId)
    .order('snapshot_at', { ascending: false })
    .limit(1)
    .single();
  return data?.snapshot || {};
}

module.exports = { buildContext };
