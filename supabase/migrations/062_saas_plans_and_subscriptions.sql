-- ============================================================
-- 062_saas_plans_and_subscriptions
--
-- Turns the multi-account CRM into a sellable SaaS:
--
--   * `plans`                — the catalogue (limits + INR price). Read by
--                              any signed-in user; edited only by the
--                              platform owner through the service role.
--   * `account_subscriptions` — one row per account: plan, status, trial
--                              end, paid-through date, comp flag. Members
--                              may READ their own row; only the service
--                              role writes (billing webhooks, super-admin).
--   * `platform_settings`    — single-row platform switches (sign-up mode).
--   * `platform_audit_log`   — every super-admin action, service role only.
--
-- Behaviour:
--   * Every new account starts a 14-day trial automatically (trigger on
--     `accounts`, so it covers sign-up AND the "removed member gets a fresh
--     account" path in 018/047/055).
--   * `account_is_writable(account_id)` decides whether a business may still
--     change data: trial / paid period + a short grace, comped accounts
--     always, suspended accounts never. RESTRICTIVE RLS policies apply it to
--     INSERT/UPDATE by signed-in users on every tenant table — so a lapsed
--     account becomes read-only. Deletes stay allowed (a business can always
--     remove its own data) and NOTHING is ever deleted by this migration.
--     The webhook runs as the service role, so inbound customer messages are
--     still stored for lapsed accounts — no customer data is lost.
--   * `get_account_entitlements(account_id)` returns plan, status, limits and
--     current usage as JSON — the single source of truth the app reads.
--   * Contact and team-member limits are enforced in the database for
--     signed-in users. Contacts created by the webhook (a new customer
--     messaging in) are never blocked.
--
-- Existing accounts (created before this migration) are marked active and
-- comped on the top plan so nothing that already works stops working; the
-- platform owner can change that from the super-admin console.
-- ============================================================

-- ------------------------------------------------------------
-- Plans
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plans (
  id                              TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9_]{2,32}$'),
  name                            TEXT NOT NULL,
  description                     TEXT,
  price_inr_monthly               INTEGER NOT NULL DEFAULT 0 CHECK (price_inr_monthly >= 0),
  max_members                     INTEGER NOT NULL CHECK (max_members >= 1),
  max_contacts                    INTEGER NOT NULL CHECK (max_contacts >= 0),
  max_broadcast_messages_monthly  INTEGER NOT NULL CHECK (max_broadcast_messages_monthly >= 0),
  max_ai_replies_monthly          INTEGER NOT NULL CHECK (max_ai_replies_monthly >= 0),
  max_voice_minutes_monthly       INTEGER NOT NULL DEFAULT 0 CHECK (max_voice_minutes_monthly >= 0),
  sort_order                      INTEGER NOT NULL DEFAULT 0,
  is_public                       BOOLEAN NOT NULL DEFAULT TRUE,
  -- Filled in part 2 (Razorpay): the Razorpay plan this maps to.
  razorpay_plan_id                TEXT,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plans_select ON plans;
CREATE POLICY plans_select ON plans FOR SELECT TO authenticated USING (TRUE);
GRANT SELECT ON plans TO authenticated;
GRANT ALL ON plans TO service_role;

-- Starter suggestions (INR / month). Editable later in the super-admin
-- console; ON CONFLICT keeps any edits the owner has already made.
INSERT INTO plans (id, name, description, price_inr_monthly, max_members, max_contacts,
                   max_broadcast_messages_monthly, max_ai_replies_monthly, max_voice_minutes_monthly, sort_order)
VALUES
  ('starter', 'Starter', 'For a single owner or a small shop getting started.', 999,  2,  1000,  1000,   300, 0, 10),
  ('growth',  'Growth',  'For growing teams that broadcast and automate.',      2499, 5,  10000, 10000,  2000, 0, 20),
  ('pro',     'Pro',     'For busy businesses with larger teams.',              4999, 15, 50000, 50000, 10000, 0, 30)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- Subscriptions
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status_enum') THEN
    CREATE TYPE subscription_status_enum AS ENUM
      ('trialing', 'active', 'past_due', 'canceled', 'suspended');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS account_subscriptions (
  account_id                UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  plan_id                   TEXT NOT NULL REFERENCES plans(id) ON UPDATE CASCADE,
  status                    subscription_status_enum NOT NULL DEFAULT 'trialing',
  trial_ends_at             TIMESTAMPTZ,
  -- End of the period already paid for (part 2: set by Razorpay webhooks).
  current_period_end        TIMESTAMPTZ,
  -- Free forever (the owner's own accounts, partners, demos).
  is_comped                 BOOLEAN NOT NULL DEFAULT FALSE,
  suspended_reason          TEXT,
  razorpay_customer_id      TEXT,
  razorpay_subscription_id  TEXT UNIQUE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_subscriptions_status
  ON account_subscriptions(status, trial_ends_at);

ALTER TABLE account_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_subscriptions_select ON account_subscriptions;
CREATE POLICY account_subscriptions_select ON account_subscriptions
  FOR SELECT TO authenticated USING (is_account_member(account_id, 'viewer'));
-- No INSERT/UPDATE/DELETE policies: only the service role and the
-- SECURITY DEFINER trigger below write subscriptions.
GRANT SELECT ON account_subscriptions TO authenticated;
GRANT ALL ON account_subscriptions TO service_role;

-- updated_at maintenance (reuses the helper from 001).
DROP TRIGGER IF EXISTS update_plans_updated_at ON plans;
CREATE TRIGGER update_plans_updated_at
  BEFORE UPDATE ON plans FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_account_subscriptions_updated_at ON account_subscriptions;
CREATE TRIGGER update_account_subscriptions_updated_at
  BEFORE UPDATE ON account_subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- Platform settings + audit log (service role only)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_settings (
  id                  BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  signup_mode         TEXT NOT NULL DEFAULT 'open' CHECK (signup_mode IN ('open', 'invite_only')),
  trial_days          INTEGER NOT NULL DEFAULT 14 CHECK (trial_days BETWEEN 0 AND 365),
  default_plan_id     TEXT NOT NULL DEFAULT 'starter' REFERENCES plans(id) ON UPDATE CASCADE,
  grace_days          INTEGER NOT NULL DEFAULT 3 CHECK (grace_days BETWEEN 0 AND 60),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO platform_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
GRANT ALL ON platform_settings TO service_role;

CREATE TABLE IF NOT EXISTS platform_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_email   TEXT NOT NULL,
  action        TEXT NOT NULL,
  account_id    UUID REFERENCES accounts(id) ON DELETE SET NULL,
  details       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_platform_audit_log_created ON platform_audit_log(created_at DESC);
ALTER TABLE platform_audit_log ENABLE ROW LEVEL SECURITY;
GRANT ALL ON platform_audit_log TO service_role;

-- ------------------------------------------------------------
-- New account => trial subscription
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_trial_subscription()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings platform_settings%ROWTYPE;
BEGIN
  SELECT * INTO v_settings FROM platform_settings WHERE id;
  INSERT INTO account_subscriptions (account_id, plan_id, status, trial_ends_at)
  VALUES (
    NEW.id,
    COALESCE(v_settings.default_plan_id, 'starter'),
    'trialing',
    NOW() + make_interval(days => COALESCE(v_settings.trial_days, 14))
  )
  ON CONFLICT (account_id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block account creation (and therefore sign-up) on billing
  -- bookkeeping; a missing row is treated as writable and is visible in
  -- the super-admin console.
  RAISE WARNING 'create_trial_subscription failed for account %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.create_trial_subscription() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_account_created_subscription ON accounts;
CREATE TRIGGER on_account_created_subscription
  AFTER INSERT ON accounts
  FOR EACH ROW EXECUTE FUNCTION public.create_trial_subscription();

-- Backfill: accounts that existed before SaaS mode keep working.
INSERT INTO account_subscriptions (account_id, plan_id, status, is_comped)
SELECT a.id, 'pro', 'active', TRUE
FROM accounts a
ON CONFLICT (account_id) DO NOTHING;

-- ------------------------------------------------------------
-- Writability
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.account_is_writable(target_account_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN s.account_id IS NULL THEN TRUE                -- no row: fail open
    WHEN s.status = 'suspended' THEN FALSE
    WHEN s.is_comped THEN TRUE
    WHEN s.status = 'trialing' THEN
      COALESCE(s.trial_ends_at, NOW()) + make_interval(days => g.grace_days) > NOW()
    WHEN s.status IN ('active', 'past_due') THEN
      s.current_period_end IS NULL
      OR s.current_period_end + make_interval(days => g.grace_days) > NOW()
    WHEN s.status = 'canceled' THEN
      s.current_period_end IS NOT NULL AND s.current_period_end > NOW()
    ELSE FALSE
  END
  FROM (SELECT target_account_id AS id) t
  LEFT JOIN account_subscriptions s ON s.account_id = t.id
  CROSS JOIN LATERAL (
    SELECT COALESCE((SELECT grace_days FROM platform_settings WHERE id), 3) AS grace_days
  ) g;
$$;
ALTER FUNCTION public.account_is_writable(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.account_is_writable(UUID) TO authenticated, service_role;

-- RESTRICTIVE policies AND together with the existing permissive ones,
-- so they can only ever narrow access. Applied to every tenant table that
-- carries account_id, except identity/membership tables and harmless
-- per-user state (notifications read flags, presence heartbeats) and the
-- billing tables themselves.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'account_id' AND NOT a.attisdropped
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
      AND c.relname NOT IN (
        'profiles', 'accounts', 'account_invitations', 'notifications', 'member_presence',
        'account_subscriptions', 'platform_audit_log'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS saas_writable_insert ON public.%I', r.relname);
    EXECUTE format(
      'CREATE POLICY saas_writable_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated '
      'WITH CHECK (public.account_is_writable(account_id))', r.relname);
    EXECUTE format('DROP POLICY IF EXISTS saas_writable_update ON public.%I', r.relname);
    EXECUTE format(
      'CREATE POLICY saas_writable_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated '
      'USING (public.account_is_writable(account_id)) WITH CHECK (public.account_is_writable(account_id))',
      r.relname);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- Usage + entitlements
-- ------------------------------------------------------------
-- Platform-provided AI: replies are counted per account per month. The
-- column distinguishes calls paid by the platform key from a business's
-- own key (own-key calls never count against the plan).
ALTER TABLE ai_usage_log
  ADD COLUMN IF NOT EXISTS key_source TEXT NOT NULL DEFAULT 'own'
    CHECK (key_source IN ('own', 'platform'));
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_platform_month
  ON ai_usage_log(account_id, created_at) WHERE key_source = 'platform';

-- Let a business choose the platform's AI instead of bringing a key.
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS use_platform_key BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ai_configs ALTER COLUMN api_key DROP NOT NULL;
ALTER TABLE ai_configs ALTER COLUMN model DROP NOT NULL;
ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_key_present;
ALTER TABLE ai_configs ADD CONSTRAINT ai_configs_key_present
  CHECK (use_platform_key OR (api_key IS NOT NULL AND model IS NOT NULL));

CREATE OR REPLACE FUNCTION public.get_account_entitlements(target_account_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub   account_subscriptions%ROWTYPE;
  v_plan  plans%ROWTYPE;
  v_month TIMESTAMPTZ := date_trunc('month', NOW());
  v_grace INTEGER;
BEGIN
  -- Members may read their own account; the service role reads any.
  -- Inside SECURITY DEFINER, current_user is the function owner, so the
  -- caller is identified from the request's JWT role instead.
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT is_account_member(target_account_id, 'viewer') THEN
    RAISE EXCEPTION 'not a member of this account' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_sub FROM account_subscriptions WHERE account_id = target_account_id;
  SELECT * INTO v_plan FROM plans
    WHERE id = COALESCE(v_sub.plan_id, (SELECT default_plan_id FROM platform_settings WHERE id), 'starter');
  SELECT COALESCE(grace_days, 3) INTO v_grace FROM platform_settings WHERE id;

  RETURN jsonb_build_object(
    'account_id', target_account_id,
    'plan', jsonb_build_object(
      'id', v_plan.id, 'name', v_plan.name, 'price_inr_monthly', v_plan.price_inr_monthly),
    'status', COALESCE(v_sub.status::text, 'active'),
    'is_comped', COALESCE(v_sub.is_comped, FALSE),
    'trial_ends_at', v_sub.trial_ends_at,
    'current_period_end', v_sub.current_period_end,
    'grace_days', COALESCE(v_grace, 3),
    'writable', account_is_writable(target_account_id),
    'limits', jsonb_build_object(
      'members', v_plan.max_members,
      'contacts', v_plan.max_contacts,
      'broadcast_messages_monthly', v_plan.max_broadcast_messages_monthly,
      'ai_replies_monthly', v_plan.max_ai_replies_monthly,
      'voice_minutes_monthly', v_plan.max_voice_minutes_monthly),
    'usage', jsonb_build_object(
      'members', (SELECT COUNT(*) FROM profiles WHERE account_id = target_account_id),
      'pending_invitations', (SELECT COUNT(*) FROM account_invitations
                               WHERE account_id = target_account_id
                                 AND accepted_at IS NULL AND expires_at > NOW()),
      'contacts', (SELECT COUNT(*) FROM contacts WHERE account_id = target_account_id),
      'broadcast_messages_monthly', (
        SELECT COUNT(*) FROM broadcast_recipients br
        JOIN broadcasts b ON b.id = br.broadcast_id
        WHERE b.account_id = target_account_id
          AND br.sent_at >= v_month),
      'ai_replies_monthly', (
        SELECT COUNT(*) FROM ai_usage_log
        WHERE account_id = target_account_id
          AND key_source = 'platform'
          AND created_at >= v_month),
      'voice_minutes_monthly', 0)
  );
END;
$$;
ALTER FUNCTION public.get_account_entitlements(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.get_account_entitlements(UUID) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Database-side limits for signed-in users
-- ------------------------------------------------------------
-- SECURITY INVOKER on purpose: `current_user` must be the caller's role
-- (authenticated vs service_role). As a signed-in member the caller can
-- already read its own account's contacts, subscription and the plans.
CREATE OR REPLACE FUNCTION public.enforce_contact_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER;
  v_count INTEGER;
BEGIN
  -- Only manual adds / imports by signed-in users are capped. Contacts
  -- created by the webhook (service role) for a customer who messaged in
  -- are never blocked — losing an inbound customer is worse than going
  -- over a limit.
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;
  SELECT p.max_contacts INTO v_limit
  FROM account_subscriptions s JOIN plans p ON p.id = s.plan_id
  WHERE s.account_id = NEW.account_id AND NOT s.is_comped;
  IF v_limit IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT COUNT(*) INTO v_count FROM contacts WHERE account_id = NEW.account_id;
  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'plan_limit_contacts: your plan allows % contacts', v_limit
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.enforce_contact_limit() OWNER TO postgres;

DROP TRIGGER IF EXISTS enforce_contact_limit ON contacts;
CREATE TRIGGER enforce_contact_limit
  BEFORE INSERT ON contacts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_contact_limit();

CREATE OR REPLACE FUNCTION public.enforce_member_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER;
  v_used  INTEGER;
BEGIN
  SELECT p.max_members INTO v_limit
  FROM account_subscriptions s JOIN plans p ON p.id = s.plan_id
  WHERE s.account_id = NEW.account_id AND NOT s.is_comped;
  IF v_limit IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT
    (SELECT COUNT(*) FROM profiles WHERE account_id = NEW.account_id)
    + (SELECT COUNT(*) FROM account_invitations
       WHERE account_id = NEW.account_id AND accepted_at IS NULL AND expires_at > NOW())
  INTO v_used;
  IF v_used >= v_limit THEN
    RAISE EXCEPTION 'plan_limit_members: your plan allows % team members', v_limit
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.enforce_member_limit() OWNER TO postgres;

DROP TRIGGER IF EXISTS enforce_member_limit ON account_invitations;
CREATE TRIGGER enforce_member_limit
  BEFORE INSERT ON account_invitations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_member_limit();

-- ------------------------------------------------------------
-- Invite-only sign-up (off by default)
-- ------------------------------------------------------------
-- When platform_settings.signup_mode = 'invite_only', a new auth user is
-- only allowed if the platform owner has pre-approved the email in
-- `platform_signup_allowlist`. Team invitations work as before: an invited
-- teammate signs up with an approved email or the owner approves it.
CREATE TABLE IF NOT EXISTS platform_signup_allowlist (
  email       TEXT PRIMARY KEY CHECK (email = lower(email)),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE platform_signup_allowlist ENABLE ROW LEVEL SECURITY;
GRANT ALL ON platform_signup_allowlist TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_signup_mode()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode TEXT;
BEGIN
  SELECT signup_mode INTO v_mode FROM platform_settings WHERE id;
  IF COALESCE(v_mode, 'open') = 'invite_only'
     AND NOT EXISTS (
       SELECT 1 FROM platform_signup_allowlist WHERE email = lower(COALESCE(NEW.email, ''))
     ) THEN
    RAISE EXCEPTION 'signups_closed: sign-up is by invitation only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.enforce_signup_mode() OWNER TO postgres;

DROP TRIGGER IF EXISTS enforce_signup_mode ON auth.users;
CREATE TRIGGER enforce_signup_mode
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_signup_mode();
