-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════
-- THE PARTNER — Notifications Table
-- Powers the dashboard real-time alert feed.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  message     TEXT,
  severity    TEXT DEFAULT 'medium'
                CHECK (severity IN ('low','medium','high','critical')),
  read        BOOLEAN NOT NULL DEFAULT FALSE,
  action_id   UUID REFERENCES action_queue(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_business
  ON notifications(business_id, read, created_at DESC);

-- Grant access to roles
GRANT ALL ON notifications TO service_role;
GRANT SELECT, INSERT, UPDATE ON notifications TO authenticated;

-- Enable Supabase Realtime on this table so the dashboard receives
-- live inserts without polling.
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
