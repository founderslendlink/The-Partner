-- ═══════════════════════════════════════════════════════════════════
-- THE PARTNER — SMS Connections Table (Priority 1B)
-- Run AFTER 001–008 in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sms_connections (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  account_sid  TEXT NOT NULL,
  auth_token   TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sms_connections_business
  ON sms_connections(business_id);

-- Permissions
GRANT ALL ON sms_connections TO service_role;
GRANT SELECT ON sms_connections TO authenticated;

-- Add send_sms permission rule for existing businesses
INSERT INTO permission_rules (business_id, action_type, rule)
SELECT id, 'send_sms', 'approval_required'
FROM businesses
WHERE active = TRUE
ON CONFLICT (business_id, action_type) DO NOTHING;

-- Add send_email permission rule for existing businesses (if missing)
INSERT INTO permission_rules (business_id, action_type, rule)
SELECT id, 'send_email', 'approval_required'
FROM businesses
WHERE active = TRUE
ON CONFLICT (business_id, action_type) DO NOTHING;

-- Add book_meeting permission rule
INSERT INTO permission_rules (business_id, action_type, rule)
SELECT id, 'book_meeting', 'approval_required'
FROM businesses
WHERE active = TRUE
ON CONFLICT (business_id, action_type) DO NOTHING;
