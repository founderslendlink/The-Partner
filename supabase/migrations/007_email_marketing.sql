-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════
-- THE PARTNER — Email Marketing Tables (Priority 3)
-- Run AFTER 001–006.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS email_campaigns (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  subject          TEXT NOT NULL,
  body             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','scheduled','sending','sent','failed')),
  recipient_count  INTEGER NOT NULL DEFAULT 0,
  sent_count       INTEGER NOT NULL DEFAULT 0,
  open_count       INTEGER NOT NULL DEFAULT 0,
  click_count      INTEGER NOT NULL DEFAULT 0,
  open_rate        FLOAT,
  click_rate       FLOAT,
  scheduled_at     TIMESTAMPTZ,
  sent_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_connections (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL CHECK (provider IN ('sendgrid','mailchimp','convertkit','smtp')),
  api_key      TEXT,
  smtp_host    TEXT,
  smtp_port    INTEGER,
  smtp_user    TEXT,
  smtp_pass    TEXT,
  from_email   TEXT NOT NULL,
  from_name    TEXT NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id, provider)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_email_campaigns_business
  ON email_campaigns(business_id, status, created_at DESC);

-- Grant access
GRANT ALL ON email_campaigns TO service_role;
GRANT ALL ON email_connections TO service_role;
GRANT SELECT, INSERT, UPDATE ON email_campaigns TO authenticated;
GRANT SELECT ON email_connections TO authenticated;
