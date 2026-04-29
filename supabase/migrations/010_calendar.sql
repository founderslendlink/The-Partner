-- ═══════════════════════════════════════════════════════════════════
-- THE PARTNER — Calendar Integration Tables (Priority 2)
-- Run AFTER 001–009 in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS calendar_connections (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL DEFAULT 'google'
                     CHECK (provider IN ('google', 'outlook')),
  access_token     TEXT NOT NULL,
  refresh_token    TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  calendar_id      TEXT NOT NULL DEFAULT 'primary',
  working_hours    JSONB NOT NULL DEFAULT '{
    "monday":    {"start": "09:00", "end": "17:00"},
    "tuesday":   {"start": "09:00", "end": "17:00"},
    "wednesday": {"start": "09:00", "end": "17:00"},
    "thursday":  {"start": "09:00", "end": "17:00"},
    "friday":    {"start": "09:00", "end": "17:00"},
    "saturday":  null,
    "sunday":    null
  }',
  connected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id, provider)
);

CREATE TABLE IF NOT EXISTS meetings (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  lead_id          UUID REFERENCES leads(id) ON DELETE SET NULL,
  opportunity_id   UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  title            TEXT NOT NULL,
  start_time       TIMESTAMPTZ NOT NULL,
  end_time         TIMESTAMPTZ NOT NULL,
  platform_event_id TEXT,
  meeting_link     TEXT,
  status           TEXT NOT NULL DEFAULT 'scheduled'
                     CHECK (status IN ('scheduled','completed','cancelled','no_show')),
  briefing_sent    BOOLEAN NOT NULL DEFAULT FALSE,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_calendar_connections_business
  ON calendar_connections(business_id);

CREATE INDEX IF NOT EXISTS idx_meetings_business_time
  ON meetings(business_id, start_time);

CREATE INDEX IF NOT EXISTS idx_meetings_briefing_pending
  ON meetings(business_id, start_time, briefing_sent)
  WHERE briefing_sent = FALSE AND status = 'scheduled';

-- Permissions
GRANT ALL ON calendar_connections TO service_role;
GRANT ALL ON meetings TO service_role;
GRANT SELECT ON calendar_connections TO authenticated;
GRANT SELECT, INSERT, UPDATE ON meetings TO authenticated;
