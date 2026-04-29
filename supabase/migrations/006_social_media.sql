-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════
-- THE PARTNER — Social Media Tables (Priority 2)
-- Run AFTER 001–005.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS content_posts (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  platform         TEXT NOT NULL CHECK (platform IN (
                     'instagram','linkedin','twitter','facebook','tiktok'
                   )),
  content          TEXT NOT NULL,
  media_urls       TEXT[]  NOT NULL DEFAULT '{}',
  hashtags         TEXT[]  NOT NULL DEFAULT '{}',
  scheduled_at     TIMESTAMPTZ,
  published_at     TIMESTAMPTZ,
  platform_post_id TEXT,
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','scheduled','published','failed')),
  performance      JSONB NOT NULL DEFAULT '{}',
  campaign_id      UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS social_connections (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  platform         TEXT NOT NULL,
  access_token     TEXT NOT NULL,
  refresh_token    TEXT,
  account_id       TEXT,
  account_name     TEXT,
  token_expires_at TIMESTAMPTZ,
  connected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id, platform)
);

CREATE TABLE IF NOT EXISTS content_campaigns (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  type         TEXT CHECK (type IN (
                 'product_push','awareness','nurture','launch','re_engagement'
               )),
  platforms    TEXT[] NOT NULL DEFAULT '{}',
  start_date   DATE,
  end_date     DATE,
  status       TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','active','paused','completed')),
  performance  JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_content_posts_business
  ON content_posts(business_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_content_posts_scheduled
  ON content_posts(status, scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_social_connections_business
  ON social_connections(business_id, platform);

-- Grant access
GRANT ALL ON content_posts TO service_role;
GRANT ALL ON social_connections TO service_role;
GRANT ALL ON content_campaigns TO service_role;
GRANT SELECT, INSERT, UPDATE ON content_posts TO authenticated;
GRANT SELECT ON social_connections TO authenticated;
GRANT SELECT, INSERT, UPDATE ON content_campaigns TO authenticated;
