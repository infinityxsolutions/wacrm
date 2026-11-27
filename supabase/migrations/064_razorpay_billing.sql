-- ============================================================
-- 064_razorpay_billing
--
-- Paid subscriptions through Razorpay (SaaS part 2).
--
--   * plans.price_inr_yearly   — optional yearly price in rupees. When NULL
--                                the app charges 10 x the monthly price
--                                ("two months free").
--   * plans.razorpay_plans     — the Razorpay plan ids created for this plan
--                                and the rupee amount each was created with.
--                                Razorpay plans are immutable, so a price
--                                change simply creates a new one at the next
--                                checkout; existing subscribers keep theirs.
--   * account_subscriptions    — billing interval + "cancels at period end".
--   * billing_payments         — one row per captured payment (invoice
--                                history). Admins of the account may read;
--                                only the service role (the Razorpay webhook)
--                                writes. Amounts are in paise (integers).
--   * billing_events           — Razorpay webhook event ids already seen, for
--                                idempotency and debugging. Service role only.
--
-- Nothing is deleted or rewritten; every statement is additive.
-- ============================================================

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS price_inr_yearly INTEGER
    CHECK (price_inr_yearly IS NULL OR price_inr_yearly >= 0),
  ADD COLUMN IF NOT EXISTS razorpay_plans JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE account_subscriptions
  ADD COLUMN IF NOT EXISTS billing_interval TEXT
    CHECK (billing_interval IN ('monthly', 'yearly')),
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;

-- ------------------------------------------------------------
-- Payment history
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_payments (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  razorpay_payment_id       TEXT NOT NULL UNIQUE,
  razorpay_subscription_id  TEXT,
  razorpay_invoice_id       TEXT,
  plan_id                   TEXT,
  billing_interval          TEXT CHECK (billing_interval IN ('monthly', 'yearly')),
  amount_paise              BIGINT NOT NULL CHECK (amount_paise >= 0),
  currency                  TEXT NOT NULL DEFAULT 'INR',
  status                    TEXT NOT NULL,
  method                    TEXT,
  paid_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_payments_account
  ON billing_payments(account_id, paid_at DESC);

ALTER TABLE billing_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_payments_select ON billing_payments;
CREATE POLICY billing_payments_select ON billing_payments
  FOR SELECT TO authenticated USING (is_account_member(account_id, 'admin'));
GRANT SELECT ON billing_payments TO authenticated;
GRANT ALL ON billing_payments TO service_role;

DROP TRIGGER IF EXISTS update_billing_payments_updated_at ON billing_payments;
CREATE TRIGGER update_billing_payments_updated_at
  BEFORE UPDATE ON billing_payments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- Webhook idempotency log (no policies: service role only)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_events (
  event_id      TEXT PRIMARY KEY,
  event_type    TEXT NOT NULL,
  account_id    UUID,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ,
  error         TEXT
);

ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
GRANT ALL ON billing_events TO service_role;
