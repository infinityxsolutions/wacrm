-- ============================================================
-- 063_business_autopilot
--
-- Stores the answers a business gives in the Autopilot questionnaire
-- (one industry pack per account) and what GrowthXAi generated from them,
-- so the setup can be re-run after edits and reused later (voice scripts,
-- promo images, template resubmission).
--
-- Members may read their own profile; only admins/owners may write it.
-- Writes also respect SaaS read-only mode (062).
-- ============================================================

CREATE TABLE IF NOT EXISTS business_profiles (
  account_id    UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  pack          TEXT NOT NULL CHECK (pack ~ '^[a-z0-9_]{2,40}$'),
  answers       JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated     JSONB NOT NULL DEFAULT '{}'::jsonb,
  applied_at    TIMESTAMPTZ,
  applied_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_profiles_select ON business_profiles;
CREATE POLICY business_profiles_select ON business_profiles
  FOR SELECT TO authenticated USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS business_profiles_insert ON business_profiles;
CREATE POLICY business_profiles_insert ON business_profiles
  FOR INSERT TO authenticated WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS business_profiles_update ON business_profiles;
CREATE POLICY business_profiles_update ON business_profiles
  FOR UPDATE TO authenticated
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS business_profiles_delete ON business_profiles;
CREATE POLICY business_profiles_delete ON business_profiles
  FOR DELETE TO authenticated USING (is_account_member(account_id, 'admin'));

-- SaaS read-only mode, same as every other tenant table (062).
DROP POLICY IF EXISTS saas_writable_insert ON business_profiles;
CREATE POLICY saas_writable_insert ON business_profiles AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.account_is_writable(account_id));
DROP POLICY IF EXISTS saas_writable_update ON business_profiles;
CREATE POLICY saas_writable_update ON business_profiles AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.account_is_writable(account_id)) WITH CHECK (public.account_is_writable(account_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON business_profiles TO authenticated;
GRANT ALL ON business_profiles TO service_role;

DROP TRIGGER IF EXISTS update_business_profiles_updated_at ON business_profiles;
CREATE TRIGGER update_business_profiles_updated_at
  BEFORE UPDATE ON business_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
