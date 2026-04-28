-- ═══════════════════════════════════════════════════════════════════
-- THE PARTNER — Complete Database Schema
-- Run this in your Supabase SQL editor or via migrate.js
-- ═══════════════════════════════════════════════════════════════════

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ─────────────────────────────────────────────────────────────────────
-- TIER 1: STRUCTURED CRM TABLES
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS businesses (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  owner_id      TEXT NOT NULL,
  mode          TEXT NOT NULL DEFAULT 'balanced_mode'
                  CHECK (mode IN ('booking_mode','product_push_mode','balanced_mode',
                                  'admin_mode','strategy_mode','onboarding_mode')),
  settings      JSONB NOT NULL DEFAULT '{}',
  timezone      TEXT NOT NULL DEFAULT 'America/Chicago',
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leads (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  email               TEXT,
  phone               TEXT,
  source              TEXT,
  status              TEXT NOT NULL DEFAULT 'new'
                        CHECK (status IN ('new','contacted','qualified','proposal',
                                          'negotiation','won','lost')),
  lead_score          INTEGER DEFAULT NULL CHECK (lead_score BETWEEN 1 AND 100),
  last_contacted_at   TIMESTAMPTZ,
  assigned_agent      TEXT DEFAULT 'sales_pipeline',
  metadata            JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS opportunities (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  lead_id         UUID REFERENCES leads(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  stage           TEXT NOT NULL DEFAULT 'prospect'
                    CHECK (stage IN ('prospect','proposal','negotiation','won','lost')),
  value           NUMERIC(12,2) NOT NULL DEFAULT 0,
  close_date      DATE,
  probability     FLOAT CHECK (probability BETWEEN 0 AND 1),
  stalled_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id           UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title                 TEXT NOT NULL,
  assigned_agent        TEXT DEFAULT 'operations_memory',
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','in_progress','overdue','done','cancelled')),
  priority              INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  due_at                TIMESTAMPTZ,
  related_entity_type   TEXT,
  related_entity_id     UUID,
  context               JSONB NOT NULL DEFAULT '{}',
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS interactions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  lead_id       UUID REFERENCES leads(id) ON DELETE SET NULL,
  channel       TEXT NOT NULL
                  CHECK (channel IN ('sms','email','telegram','call','discord','other')),
  direction     TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  content       TEXT,
  sentiment     FLOAT CHECK (sentiment BETWEEN -1 AND 1),
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  description         TEXT,
  price               NUMERIC(12,2),
  conversion_rate     FLOAT DEFAULT NULL,
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  promotion_active    BOOLEAN NOT NULL DEFAULT FALSE,
  metadata            JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  period        TEXT,
  content       JSONB NOT NULL DEFAULT '{}',
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────
-- TIER 2: CONTEXTUAL MEMORY
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS memory_entries (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type          TEXT NOT NULL
                  CHECK (type IN ('meeting_summary','preference','pattern',
                                  'insight','decision','note')),
  content       TEXT NOT NULL,
  importance    INTEGER NOT NULL DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
  source        TEXT NOT NULL DEFAULT 'system',
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memory_tags (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  memory_id       UUID NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
  tag             TEXT NOT NULL,
  entity_type     TEXT,
  entity_id       UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memory_relationships (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  memory_id_a     UUID NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
  memory_id_b     UUID NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
  relationship    TEXT NOT NULL DEFAULT 'related',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────
-- TIER 3: SEMANTIC VECTOR MEMORY
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS memory_vectors (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  memory_id             UUID NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
  embedding             VECTOR(1536) NOT NULL,
  model                 TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  similarity_threshold  FLOAT DEFAULT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- IVFFlat index for fast approximate nearest-neighbor search
-- NOTE: Create this AFTER you have at least 100 vectors for good performance
-- CREATE INDEX IF NOT EXISTS memory_vectors_embedding_idx
--   ON memory_vectors USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ─────────────────────────────────────────────────────────────────────
-- EXECUTION TABLES
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS action_queue (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  action_type     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approval_required','scheduled',
                                      'executing','completed','failed',
                                      'dead_letter','rejected')),
  payload         JSONB NOT NULL DEFAULT '{}',
  priority        INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  retry_count     INTEGER NOT NULL DEFAULT 0,
  max_retries     INTEGER NOT NULL DEFAULT 3,
  scheduled_at    TIMESTAMPTZ,
  approved_by     TEXT,
  rejection_reason TEXT,
  result          JSONB,
  locked_at       TIMESTAMPTZ,
  locked_by       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_at     TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS decision_logs (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id             UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  agent                   TEXT NOT NULL,
  session_id              UUID,
  task                    TEXT,
  reasoning               TEXT,
  confidence              FLOAT,
  proposed_actions_count  INTEGER DEFAULT 0,
  outcome                 JSONB,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permission_rules (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  action_type   TEXT NOT NULL,
  rule          TEXT NOT NULL CHECK (rule IN ('auto','approval_required','blocked')),
  conditions    JSONB NOT NULL DEFAULT '{}',
  notif_channels TEXT[] DEFAULT ARRAY['telegram'],
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id, action_type)
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  action_queue_id   UUID NOT NULL REFERENCES action_queue(id) ON DELETE CASCADE,
  telegram_message_id TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','rejected','expired')),
  responded_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────
-- SESSION MANAGEMENT
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL,
  channel         TEXT NOT NULL,
  active_intent   TEXT,
  context         JSONB NOT NULL DEFAULT '{}',
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '2 hours'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS session_context (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────
-- HEARTBEAT & EVENT SYSTEM
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS heartbeat_rules (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  check_type    TEXT NOT NULL CHECK (check_type IN ('urgent','pipeline','strategy')),
  conditions    JSONB NOT NULL DEFAULT '{}',
  severity      TEXT NOT NULL CHECK (severity IN ('high','medium','low')),
  frequency     TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  actions_to_trigger TEXT[] DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS heartbeat_checks (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  rule_id           UUID REFERENCES heartbeat_rules(id) ON DELETE SET NULL,
  check_type        TEXT NOT NULL,
  frequency         TEXT NOT NULL,
  last_run_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  violations_found  INTEGER NOT NULL DEFAULT 0,
  result            JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS heartbeat_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  rule_id         UUID REFERENCES heartbeat_rules(id) ON DELETE SET NULL,
  entity_type     TEXT NOT NULL,
  entity_id       UUID,
  severity        TEXT NOT NULL,
  description     TEXT,
  payload         JSONB NOT NULL DEFAULT '{}',
  alerted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cooldown_until  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS heartbeat_actions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  heartbeat_event_id  UUID NOT NULL REFERENCES heartbeat_events(id) ON DELETE CASCADE,
  action_queue_id     UUID REFERENCES action_queue(id) ON DELETE SET NULL,
  action_type         TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type                TEXT NOT NULL,
  entity_type         TEXT,
  entity_id           UUID,
  payload             JSONB NOT NULL DEFAULT '{}',
  processed           BOOLEAN NOT NULL DEFAULT FALSE,
  triggered_actions   UUID[] DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────
-- SYSTEM MODE TRACKING
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS system_modes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE UNIQUE,
  current_mode  TEXT NOT NULL DEFAULT 'balanced_mode',
  activated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_by  TEXT NOT NULL DEFAULT 'system'
);

CREATE TABLE IF NOT EXISTS mode_history (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  from_mode     TEXT NOT NULL,
  to_mode       TEXT NOT NULL,
  reason        TEXT,
  changed_by    TEXT NOT NULL DEFAULT 'operator',
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────
-- METRICS SYSTEM
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS metrics (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  metric_key    TEXT NOT NULL,
  value         FLOAT NOT NULL,
  period        TEXT NOT NULL CHECK (period IN ('hourly','daily','weekly','monthly')),
  period_start  TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS metric_snapshots (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  snapshot      JSONB NOT NULL DEFAULT '{}',
  snapshot_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────
-- SCHEDULING
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  job_type        TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  cron_expression TEXT,
  next_run_at     TIMESTAMPTZ NOT NULL,
  last_run_at     TIMESTAMPTZ,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────
-- LEARNING & FEEDBACK
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS feedback_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  action_id       UUID REFERENCES action_queue(id) ON DELETE SET NULL,
  result          TEXT NOT NULL
                    CHECK (result IN ('approved','rejected','completed_success',
                                      'completed_failure','modified')),
  reward_score    FLOAT NOT NULL CHECK (reward_score BETWEEN -1 AND 1),
  reason          TEXT,
  outcome_data    JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outcome_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  outcome_type    TEXT NOT NULL,
  entity_type     TEXT,
  entity_id       UUID,
  data            JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────
-- FAILURE HANDLING
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS error_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID REFERENCES businesses(id) ON DELETE SET NULL,
  action_id       UUID REFERENCES action_queue(id) ON DELETE SET NULL,
  error_type      TEXT NOT NULL,
  error_code      TEXT,
  message         TEXT NOT NULL,
  stack           TEXT,
  context         JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────
-- AUDIT TRAIL
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID REFERENCES businesses(id) ON DELETE SET NULL,
  actor           TEXT NOT NULL,
  action          TEXT NOT NULL,
  entity_type     TEXT,
  entity_id       UUID,
  input_hash      TEXT,
  output          JSONB,
  ip_address      TEXT,
  ts              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit logs are append-only — no updates allowed
CREATE OR REPLACE RULE audit_no_update AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
CREATE OR REPLACE RULE audit_no_delete AS ON DELETE TO audit_logs DO INSTEAD NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- ONBOARDING
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS onboarding_state (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE UNIQUE,
  current_phase   INTEGER NOT NULL DEFAULT 1 CHECK (current_phase BETWEEN 1 AND 4),
  phase_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  data            JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────
-- PERFORMANCE INDEXES
-- ─────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_leads_business_status     ON leads(business_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_last_contacted      ON leads(business_id, last_contacted_at);
CREATE INDEX IF NOT EXISTS idx_opportunities_business    ON opportunities(business_id, stage);
CREATE INDEX IF NOT EXISTS idx_opportunities_stalled     ON opportunities(business_id, stalled_at);
CREATE INDEX IF NOT EXISTS idx_tasks_business_status     ON tasks(business_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_interactions_lead         ON interactions(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_entries_business   ON memory_entries(business_id, importance DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_tags_entity        ON memory_tags(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_action_queue_status       ON action_queue(status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_action_queue_scheduled    ON action_queue(status, scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_unprocessed        ON events(business_id, processed, created_at) WHERE processed = FALSE;
CREATE INDEX IF NOT EXISTS idx_heartbeat_events_cooldown ON heartbeat_events(business_id, entity_id, cooldown_until);
CREATE INDEX IF NOT EXISTS idx_sessions_user             ON sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_business       ON audit_logs(business_id, ts DESC);

-- ─────────────────────────────────────────────────────────────────────
-- HELPER FUNCTIONS
-- ─────────────────────────────────────────────────────────────────────

-- Semantic search function
CREATE OR REPLACE FUNCTION search_memories(
  p_business_id UUID,
  p_embedding   VECTOR(1536),
  p_threshold   FLOAT DEFAULT 0.75,
  p_limit       INT   DEFAULT 5
)
RETURNS TABLE (
  id          UUID,
  content     TEXT,
  type        TEXT,
  importance  INT,
  similarity  FLOAT,
  created_at  TIMESTAMPTZ
) LANGUAGE SQL STABLE AS $$
  SELECT
    me.id,
    me.content,
    me.type,
    me.importance,
    1 - (mv.embedding <=> p_embedding) AS similarity,
    me.created_at
  FROM memory_vectors mv
  JOIN memory_entries me ON me.id = mv.memory_id
  WHERE me.business_id = p_business_id
    AND (me.expires_at IS NULL OR me.expires_at > NOW())
    AND 1 - (mv.embedding <=> p_embedding) >= p_threshold
  ORDER BY similarity DESC
  LIMIT p_limit;
$$;

-- Auto-update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_businesses_updated
  BEFORE UPDATE ON businesses FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_leads_updated
  BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_opportunities_updated
  BEFORE UPDATE ON opportunities FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_tasks_updated
  BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_memory_entries_updated
  BEFORE UPDATE ON memory_entries FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_action_queue_updated
  BEFORE UPDATE ON action_queue FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_sessions_updated
  BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
