-- ═══════════════════════════════════════════════════════════════════
-- THE PARTNER — Role Grants
-- Run this in your Supabase SQL editor.
-- Migrations 001–003 create tables but never grant access to roles;
-- this migration fixes that gap.
-- ═══════════════════════════════════════════════════════════════════

-- service_role: used by the server (service key), bypasses RLS
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- authenticated: logged-in users (anon key + valid JWT)
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
