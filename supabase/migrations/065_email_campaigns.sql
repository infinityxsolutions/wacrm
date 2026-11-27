-- ============================================================
-- 065_email_campaigns
--
-- Email (sent through Brevo) next to WhatsApp.
--
--   * email_settings    — per business: sender name, reply-to address and the
--                         postal address that must appear in every marketing
--                         email. Members read; admins write.
--   * email_campaigns   — a message (subject + plain-text body with
--                         {{name}} style variables) and who it went to.
--   * email_recipients  — one row per recipient with its own unsubscribe
--                         token and delivery status, updated by the Brevo
--                         webhook (service role).
--   * contacts.email_opt_out — set by an unsubscribe, a hard bounce or a
--                         spam report; opted-out contacts are never emailed.
--   * plans.max_emails_monthly — monthly email allowance per plan.
--
-- Same rules as every tenant table: RLS by account membership, and the
-- SaaS read-only mode (062) applies to writes. Additive only.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS email_opt_out    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_opt_out_at TIMESTAMPTZ;

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS max_emails_monthly INTEGER NOT NULL DEFAULT 0
    CHECK (max_emails_monthly >= 0);

-- Starter suggestions; only fills plans still at the default 0, so any
-- value you already set in the Admin console is kept.
UPDATE plans SET max_emails_monthly = 500   WHERE id = 'starter' AND max_emails_monthly = 0;
UPDATE plans SET max_emails_monthly = 5000  WHERE id = 'growth'  AND max_emails_monthly = 0;
UPDATE plans SET max_emails_monthly = 25000 WHERE id = 'pro'     AND max_emails_monthly = 0;

-- ------------------------------------------------------------
-- Sender settings
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_settings (
  account_id        UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  from_name         TEXT NOT NULL CHECK (char_length(from_name) BETWEEN 1 AND 80),
  reply_to_email    TEXT NOT NULL CHECK (reply_to_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND char_length(reply_to_email) <= 254),
  business_address  TEXT NOT NULL CHECK (char_length(business_address) BETWEEN 5 AND 300),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- Campaigns
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_campaigns (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name             TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  subject          TEXT NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
  body_text        TEXT NOT NULL CHECK (char_length(body_text) BETWEEN 1 AND 20000),
  audience         JSONB NOT NULL DEFAULT '{"kind":"all"}'::jsonb,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'sent', 'failed')),
  recipient_count  INTEGER NOT NULL DEFAULT 0 CHECK (recipient_count >= 0),
  sent_count       INTEGER NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  failed_count     INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  sent_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_account ON email_campaigns(account_id, created_at DESC);

-- ------------------------------------------------------------
-- Recipients
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_recipients (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  campaign_id        UUID NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  contact_id         UUID REFERENCES contacts(id) ON DELETE SET NULL,
  email              TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'queued' CHECK (status IN
                       ('queued', 'sent', 'delivered', 'opened', 'clicked',
                        'bounced', 'failed', 'unsubscribed', 'spam')),
  brevo_message_id   TEXT,
  error              TEXT,
  unsubscribe_token  TEXT NOT NULL UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_recipients_campaign ON email_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_recipients_message ON email_recipients(brevo_message_id);
CREATE INDEX IF NOT EXISTS idx_email_recipients_account_month ON email_recipients(account_id, created_at);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
ALTER TABLE email_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_settings_select ON email_settings;
CREATE POLICY email_settings_select ON email_settings
  FOR SELECT TO authenticated USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS email_settings_insert ON email_settings;
CREATE POLICY email_settings_insert ON email_settings
  FOR INSERT TO authenticated WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS email_settings_update ON email_settings;
CREATE POLICY email_settings_update ON email_settings
  FOR UPDATE TO authenticated
  USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS email_campaigns_select ON email_campaigns;
CREATE POLICY email_campaigns_select ON email_campaigns
  FOR SELECT TO authenticated USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS email_campaigns_insert ON email_campaigns;
CREATE POLICY email_campaigns_insert ON email_campaigns
  FOR INSERT TO authenticated WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS email_campaigns_update ON email_campaigns;
CREATE POLICY email_campaigns_update ON email_campaigns
  FOR UPDATE TO authenticated
  USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS email_campaigns_delete ON email_campaigns;
CREATE POLICY email_campaigns_delete ON email_campaigns
  FOR DELETE TO authenticated USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS email_recipients_select ON email_recipients;
CREATE POLICY email_recipients_select ON email_recipients
  FOR SELECT TO authenticated USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS email_recipients_insert ON email_recipients;
CREATE POLICY email_recipients_insert ON email_recipients
  FOR INSERT TO authenticated WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS email_recipients_update ON email_recipients;
CREATE POLICY email_recipients_update ON email_recipients
  FOR UPDATE TO authenticated
  USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

-- SaaS read-only mode, same as every other tenant table (062).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['email_settings', 'email_campaigns', 'email_recipients'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS saas_writable_insert ON %I', t);
    EXECUTE format('CREATE POLICY saas_writable_insert ON %I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.account_is_writable(account_id))', t);
    EXECUTE format('DROP POLICY IF EXISTS saas_writable_update ON %I', t);
    EXECUTE format('CREATE POLICY saas_writable_update ON %I AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.account_is_writable(account_id)) WITH CHECK (public.account_is_writable(account_id))', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON email_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON email_campaigns TO authenticated;
GRANT SELECT, INSERT, UPDATE ON email_recipients TO authenticated;
GRANT ALL ON email_settings, email_campaigns, email_recipients TO service_role;

DROP TRIGGER IF EXISTS update_email_settings_updated_at ON email_settings;
CREATE TRIGGER update_email_settings_updated_at
  BEFORE UPDATE ON email_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_email_campaigns_updated_at ON email_campaigns;
CREATE TRIGGER update_email_campaigns_updated_at
  BEFORE UPDATE ON email_campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_email_recipients_updated_at ON email_recipients;
CREATE TRIGGER update_email_recipients_updated_at
  BEFORE UPDATE ON email_recipients FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- An account that has set up email or sent a campaign is not "empty": it
-- must not be silently deleted when its owner joins another account by
-- invitation. Same function as 063, with the email tables added.
CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_other_members BOOLEAN;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id
  FOR UPDATE OF p, a;

  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE account_id = v_old_account_id
      AND user_id <> v_caller_id
  ) INTO v_has_other_members;

  IF v_has_other_members THEN
    RAISE EXCEPTION 'Your account has other members; remove them or transfer ownership before joining another account'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_logs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_pending_executions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flow_runs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM deals WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM api_keys WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM webhook_endpoints WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM quick_replies WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM notifications WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_configs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_documents WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_chunks WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_usage_log WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM business_profiles WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM email_settings WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM email_campaigns WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM email_recipients WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;
