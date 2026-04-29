-- ═══════════════════════════════════════════════════════════════════
-- THE PARTNER — Default Permission Rules
-- Insert these for each new business after creation
-- ═══════════════════════════════════════════════════════════════════

-- Usage: CALL insert_default_permissions('your-business-uuid-here');

CREATE OR REPLACE PROCEDURE insert_default_permissions(p_business_id UUID)
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO permission_rules (business_id, action_type, rule, conditions, notif_channels)
  VALUES
    -- AUTO: internal state changes, no external impact
    (p_business_id, 'draft_message',        'auto',              '{}',                              ARRAY['telegram']),
    (p_business_id, 'flag_stalled_deal',    'auto',              '{}',                              ARRAY['discord']),
    (p_business_id, 'mark_task_overdue',    'auto',              '{}',                              ARRAY['discord']),
    (p_business_id, 'write_memory',         'auto',              '{}',                              '{}'),
    (p_business_id, 'post_discord_alert',   'auto',              '{}',                              '{}'),
    (p_business_id, 'send_telegram_notif',  'auto',              '{}',                              '{}'),
    (p_business_id, 'log_decision',         'auto',              '{}',                              '{}'),
    (p_business_id, 'update_metrics',       'auto',              '{}',                              '{}'),
    (p_business_id, 'reschedule_task',      'auto',              '{}',                              ARRAY['telegram']),
    (p_business_id, 'create_task',          'auto',              '{}',                              ARRAY['telegram']),
    (p_business_id, 'update_lead_score',    'auto',              '{}',                              '{}'),
    (p_business_id, 'create_lead',          'auto',              '{}',                              ARRAY['telegram']),

    -- APPROVAL REQUIRED: touches external parties or has business impact
    (p_business_id, 'send_message',         'approval_required', '{}',                              ARRAY['telegram']),
    (p_business_id, 'send_email',           'approval_required', '{}',                              ARRAY['telegram']),
    (p_business_id, 'book_meeting',         'approval_required', '{}',                              ARRAY['telegram']),
    (p_business_id, 'advance_opp_stage',    'approval_required', '{}',                              ARRAY['telegram']),
    (p_business_id, 'reassign_lead',        'approval_required', '{}',                              ARRAY['telegram']),
    (p_business_id, 'publish_content',      'approval_required', '{}',                              ARRAY['telegram']),
    (p_business_id, 'change_product_price', 'approval_required', '{}',                              ARRAY['telegram']),
    (p_business_id, 'assign_task_person',   'approval_required', '{}',                              ARRAY['telegram']),
    (p_business_id, 'trigger_campaign',     'approval_required', '{}',                              ARRAY['telegram']),
    (p_business_id, 'switch_mode',          'approval_required', '{}',                              ARRAY['telegram']),
    (p_business_id, 'close_opportunity',    'approval_required', '{}',                              ARRAY['telegram']),

    -- SOCIAL MEDIA: approval required before publishing
    (p_business_id, 'post_instagram',       'approval_required', '{}',                              ARRAY['telegram']),
    (p_business_id, 'post_linkedin',        'approval_required', '{}',                              ARRAY['telegram']),
    (p_business_id, 'post_twitter',         'approval_required', '{}',                              ARRAY['telegram']),
    (p_business_id, 'post_facebook',        'approval_required', '{}',                              ARRAY['telegram']),
    (p_business_id, 'schedule_post',        'approval_required', '{}',                              ARRAY['telegram']),
    (p_business_id, 'get_post_performance', 'auto',              '{}',                              '{}'),

    -- REFERRAL / AFFILIATE: financial actions blocked, others require approval
    (p_business_id, 'send_referral_request','approval_required', '{}',                              ARRAY['telegram']),
    (p_business_id, 'create_affiliate',     'approval_required', '{}',                              ARRAY['telegram']),
    (p_business_id, 'record_referral',      'auto',              '{}',                              '{}'),
    (p_business_id, 'pay_commission',       'blocked',           '{"reason": "financial"}',         ARRAY['telegram']),

    -- BLOCKED: irreversible or high-risk — hardcoded, cannot be changed
    (p_business_id, 'delete_record',        'blocked',           '{"reason": "irreversible"}',      ARRAY['telegram']),
    (p_business_id, 'execute_transaction',  'blocked',           '{"reason": "financial"}',         ARRAY['telegram']),
    (p_business_id, 'modify_permissions',   'blocked',           '{"reason": "safety_boundary"}',   ARRAY['telegram']),
    (p_business_id, 'send_bulk_message',    'blocked',           '{"reason": "legal_risk"}',        ARRAY['telegram']),
    (p_business_id, 'access_ext_accounts',  'blocked',           '{"reason": "security"}',          ARRAY['telegram']),
    (p_business_id, 'disable_heartbeat',    'blocked',           '{"reason": "monitoring_safety"}', ARRAY['telegram'])
  ON CONFLICT (business_id, action_type) DO NOTHING;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: insert new social + referral rules for all existing businesses
-- Run this once after deploying Priority 2 and Priority 4
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  biz RECORD;
BEGIN
  FOR biz IN SELECT id FROM businesses LOOP
    INSERT INTO permission_rules (business_id, action_type, rule, conditions, notif_channels)
    VALUES
      (biz.id, 'post_instagram',        'approval_required', '{}', ARRAY['telegram']),
      (biz.id, 'post_linkedin',         'approval_required', '{}', ARRAY['telegram']),
      (biz.id, 'post_twitter',          'approval_required', '{}', ARRAY['telegram']),
      (biz.id, 'post_facebook',         'approval_required', '{}', ARRAY['telegram']),
      (biz.id, 'schedule_post',         'approval_required', '{}', ARRAY['telegram']),
      (biz.id, 'get_post_performance',  'auto',              '{}', '{}'),
      (biz.id, 'send_referral_request', 'approval_required', '{}', ARRAY['telegram']),
      (biz.id, 'create_affiliate',      'approval_required', '{}', ARRAY['telegram']),
      (biz.id, 'record_referral',       'auto',              '{}', '{}'),
      (biz.id, 'pay_commission',        'blocked',           '{"reason": "financial"}', ARRAY['telegram'])
    ON CONFLICT (business_id, action_type) DO NOTHING;
  END LOOP;
END;
$$;
