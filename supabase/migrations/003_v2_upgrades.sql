-- ═══════════════════════════════════════════════════════════════════
-- THE PARTNER V2 — Schema Upgrades
-- Additive only. Run AFTER 001 and 002.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- UPGRADE 1: action_queue — add new columns
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE action_queue
  ADD COLUMN IF NOT EXISTS action_category TEXT
    CHECK (action_category IN (
      'communication','data_update','research',
      'content_creation','system_operation','external_execution'
    )),
  ADD COLUMN IF NOT EXISTS execution_target TEXT NOT NULL DEFAULT 'api'
    CHECK (execution_target IN ('api','browser','system')),
  ADD COLUMN IF NOT EXISTS tool_name TEXT,
  ADD COLUMN IF NOT EXISTS subtask_of UUID REFERENCES action_queue(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decomposition_id UUID,
  ADD COLUMN IF NOT EXISTS explanation TEXT,
  ADD COLUMN IF NOT EXISTS reasoning_summary TEXT;

-- ─────────────────────────────────────────────────────────────────────
-- UPGRADE 2: businesses — add operator_mode
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS operator_mode TEXT NOT NULL DEFAULT 'assisted'
    CHECK (operator_mode IN ('assisted','semi_autonomous','autonomous'));

-- ─────────────────────────────────────────────────────────────────────
-- UPGRADE 3: decision_logs — add explainability columns
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE decision_logs
  ADD COLUMN IF NOT EXISTS reasoning_summary TEXT,
  ADD COLUMN IF NOT EXISTS explanation       TEXT,
  ADD COLUMN IF NOT EXISTS tools_considered  TEXT[],
  ADD COLUMN IF NOT EXISTS tool_selected     TEXT,
  ADD COLUMN IF NOT EXISTS decomposition_id  UUID;

-- ─────────────────────────────────────────────────────────────────────
-- NEW TABLE: tools_registry
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tools_registry (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tool_name        TEXT NOT NULL UNIQUE,
  description      TEXT NOT NULL,
  input_schema     JSONB NOT NULL DEFAULT '{}',
  output_schema    JSONB NOT NULL DEFAULT '{}',
  execution_type   TEXT NOT NULL CHECK (execution_type IN ('api','browser','system')),
  permissions      TEXT[] NOT NULL DEFAULT '{}',
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  fallback_tool    TEXT,
  avg_latency_ms   INTEGER,
  success_rate     FLOAT DEFAULT 1.0,
  last_used_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────
-- NEW TABLE: task_decompositions
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_decompositions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  session_id      UUID,
  original_task   TEXT NOT NULL,
  subtasks        JSONB NOT NULL DEFAULT '[]',
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','in_progress','completed','failed')),
  agent           TEXT NOT NULL DEFAULT 'ceo',
  total_subtasks  INTEGER NOT NULL DEFAULT 0,
  done_subtasks   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────
-- NEW TABLE: browser_sessions
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS browser_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  action_id       UUID REFERENCES action_queue(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'idle'
                    CHECK (status IN ('idle','running','completed','failed','timeout')),
  target_url      TEXT,
  steps           JSONB NOT NULL DEFAULT '[]',
  result          JSONB,
  screenshot_path TEXT,
  error           TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────
-- NEW TABLE: operator_mode_history
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS operator_mode_history (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  from_mode     TEXT NOT NULL,
  to_mode       TEXT NOT NULL,
  reason        TEXT,
  changed_by    TEXT NOT NULL DEFAULT 'operator',
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────
-- NEW TABLE: environment_snapshots
-- Stores time/calendar/workload context per decision
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS environment_snapshots (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  session_id      UUID,
  current_time    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  timezone        TEXT NOT NULL,
  day_of_week     TEXT NOT NULL,
  hour_of_day     INTEGER NOT NULL,
  workload_level  TEXT NOT NULL CHECK (workload_level IN ('low','medium','high','critical')),
  urgency         TEXT NOT NULL CHECK (urgency IN ('low','normal','high','urgent')),
  calendar_state  JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────
-- INDEXES for new tables
-- ─────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_tools_registry_type    ON tools_registry(execution_type, enabled);
CREATE INDEX IF NOT EXISTS idx_task_decomp_business   ON task_decompositions(business_id, status);
CREATE INDEX IF NOT EXISTS idx_action_queue_category  ON action_queue(action_category, status);
CREATE INDEX IF NOT EXISTS idx_action_queue_target    ON action_queue(execution_target, status);
CREATE INDEX IF NOT EXISTS idx_browser_sessions_biz   ON browser_sessions(business_id, status);

-- ─────────────────────────────────────────────────────────────────────
-- SEED: Default tools registry entries
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO tools_registry (tool_name, description, input_schema, output_schema, execution_type, permissions)
VALUES
  ('send_telegram_message', 'Send a message to a Telegram chat', '{"chat_id":"string","message":"string"}', '{"sent":"boolean"}', 'api', ARRAY['send_message']),
  ('send_email', 'Send an email via configured provider', '{"to":"string","subject":"string","body":"string"}', '{"sent":"boolean","message_id":"string"}', 'api', ARRAY['send_email']),
  ('create_calendar_event', 'Create a calendar event', '{"title":"string","start":"datetime","end":"datetime","attendees":"array"}', '{"event_id":"string"}', 'api', ARRAY['book_meeting']),
  ('search_web', 'Search the web for information', '{"query":"string","max_results":"number"}', '{"results":"array"}', 'api', ARRAY['research']),
  ('scrape_webpage', 'Extract content from a webpage', '{"url":"string","selector":"string"}', '{"content":"string"}', 'browser', ARRAY['research']),
  ('fill_web_form', 'Fill and submit a web form', '{"url":"string","fields":"object","submit":"boolean"}', '{"success":"boolean","response":"string"}', 'browser', ARRAY['external_execution']),
  ('download_file', 'Download a file from a URL', '{"url":"string","filename":"string"}', '{"path":"string","size":"number"}', 'browser', ARRAY['external_execution']),
  ('update_supabase_record', 'Update a record in Supabase', '{"table":"string","id":"string","data":"object"}', '{"updated":"boolean"}', 'system', ARRAY['data_update']),
  ('query_supabase', 'Query Supabase for data', '{"table":"string","filters":"object"}', '{"rows":"array"}', 'system', ARRAY['research']),
  ('generate_content', 'Generate text content via AI', '{"prompt":"string","type":"string"}', '{"content":"string"}', 'api', ARRAY['content_creation']),
  ('post_to_discord', 'Post a message to Discord channel', '{"channel":"string","message":"string"}', '{"posted":"boolean"}', 'api', ARRAY['send_message']),
  ('read_email_inbox', 'Read recent emails from inbox', '{"max_count":"number","filter":"string"}', '{"emails":"array"}', 'api', ARRAY['research'])
ON CONFLICT (tool_name) DO NOTHING;
