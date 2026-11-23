-- ============================================================
-- 061_grant_table_privileges
--
-- Every table here is protected by row-level security, but RLS only
-- filters rows a role is already allowed to touch. The earlier
-- migrations rely on Supabase's default privileges to give the
-- `authenticated` and `service_role` roles table access in `public`.
-- Newer Supabase projects (and hardened / self-hosted ones) no longer
-- grant that automatically, and then every request from a signed-in
-- user fails with "permission denied for table profiles" (42501) — the
-- dashboard loads read-only and nothing saves.
--
-- This grants the access the app expects:
--   * authenticated: CRUD, but only on tables that have RLS enabled, so
--     the policies keep deciding which rows each user sees. A table
--     without RLS is never opened by this migration.
--   * service_role: full access, as Supabase normally provides — the
--     webhook, automation engine and public API run as this role.
--   * sequences, plus default privileges so tables added by later
--     migrations behave the same way.
-- It then re-applies 027's restriction: users may only mark
-- notifications read (UPDATE on read_at), never rewrite them.
--
-- Idempotent: GRANT/REVOKE are no-ops when already in that state, so
-- this is safe on projects where the defaults were already in place.
-- `anon` is deliberately left alone.
-- ============================================================

DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t.relname);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;

-- Keep 027's rule: notifications can only be marked as read.
REVOKE UPDATE ON public.notifications FROM authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;
