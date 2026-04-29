-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════
-- THE PARTNER — Referral & Affiliate System (Priority 4)
-- Run AFTER 001–007.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS referral_programs (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('referral','affiliate')),
  reward_type    TEXT NOT NULL CHECK (reward_type IN ('cash','credit','discount','percentage')),
  reward_value   NUMERIC(10,2) NOT NULL,
  currency       CHAR(3) NOT NULL DEFAULT 'USD',
  terms          TEXT,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS affiliates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  lead_id         UUID REFERENCES leads(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  referral_code   TEXT NOT NULL UNIQUE,
  program_id      UUID NOT NULL REFERENCES referral_programs(id),
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','paused','terminated')),
  total_referrals INTEGER NOT NULL DEFAULT 0,
  total_earned    NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_tracking (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  affiliate_id     UUID REFERENCES affiliates(id) ON DELETE SET NULL,
  referred_lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  referral_code    TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','qualified','converted','paid','rejected')),
  reward_amount    NUMERIC(10,2),
  converted_at     TIMESTAMPTZ,
  paid_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commissions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  referral_id  UUID NOT NULL REFERENCES referral_tracking(id),
  amount       NUMERIC(10,2) NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','paid','cancelled')),
  approved_at  TIMESTAMPTZ,
  paid_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_affiliates_business
  ON affiliates(business_id, status);
CREATE INDEX IF NOT EXISTS idx_affiliates_code
  ON affiliates(referral_code);
CREATE INDEX IF NOT EXISTS idx_referral_tracking_business
  ON referral_tracking(business_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commissions_affiliate
  ON commissions(affiliate_id, status);

-- Grant access
GRANT ALL ON referral_programs TO service_role;
GRANT ALL ON affiliates TO service_role;
GRANT ALL ON referral_tracking TO service_role;
GRANT ALL ON commissions TO service_role;
GRANT SELECT ON referral_programs TO authenticated;
GRANT SELECT ON affiliates TO authenticated;
GRANT SELECT ON referral_tracking TO authenticated;
GRANT SELECT ON commissions TO authenticated;
