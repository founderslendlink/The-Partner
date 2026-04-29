-- ═══════════════════════════════════════════════════════════════════
-- THE PARTNER — Automations Tables (Priority 3)
-- Run AFTER 001–010 in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS automations (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id        UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  description        TEXT,
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  trigger_type       TEXT NOT NULL CHECK (trigger_type IN (
    'lead_created',
    'lead_status_changed',
    'opportunity_stage_changed',
    'opportunity_stalled',
    'task_overdue',
    'meeting_booked',
    'meeting_completed',
    'deal_won',
    'deal_lost',
    'tag_added',
    'inbound_message',
    'form_submitted',
    'scheduled_time',
    'manual'
  )),
  trigger_conditions JSONB NOT NULL DEFAULT '{}',
  steps              JSONB NOT NULL DEFAULT '[]',
  run_count          INTEGER NOT NULL DEFAULT 0,
  last_run_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id        UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  business_id          UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  trigger_entity_type  TEXT,
  trigger_entity_id    UUID,
  status               TEXT NOT NULL DEFAULT 'running'
                         CHECK (status IN ('running','completed','failed','stopped','waiting')),
  steps_completed      INTEGER NOT NULL DEFAULT 0,
  current_step_id      TEXT,
  resume_at            TIMESTAMPTZ,
  result               JSONB NOT NULL DEFAULT '{}',
  error                TEXT,
  test_mode            BOOLEAN NOT NULL DEFAULT FALSE,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at         TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_automations_business_active
  ON automations(business_id, active);

CREATE INDEX IF NOT EXISTS idx_automations_trigger_type
  ON automations(business_id, trigger_type) WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_automation_runs_automation
  ON automation_runs(automation_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_runs_waiting
  ON automation_runs(status, resume_at) WHERE status = 'waiting';

-- Auto-update updated_at
CREATE OR REPLACE TRIGGER trg_automations_updated
  BEFORE UPDATE ON automations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Permissions
GRANT ALL ON automations TO service_role;
GRANT ALL ON automation_runs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON automations TO authenticated;
GRANT SELECT, INSERT ON automation_runs TO authenticated;
