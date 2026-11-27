'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Entitlements } from '@/lib/billing/entitlements';

export interface PublicPlan {
  id: string;
  name: string;
  description: string | null;
  price_inr_monthly: number;
  price_inr_yearly: number | null;
  max_members: number;
  max_contacts: number;
  max_broadcast_messages_monthly: number;
  max_ai_replies_monthly: number;
  max_voice_minutes_monthly: number;
  max_emails_monthly: number;
}

export interface PublicSubscription {
  billing_interval: 'monthly' | 'yearly' | null;
  cancel_at_period_end: boolean;
  has_paid_subscription: boolean;
}

export interface PaymentRow {
  id: string;
  amount_paise: number;
  currency: string;
  status: string;
  method: string | null;
  plan_id: string | null;
  billing_interval: 'monthly' | 'yearly' | null;
  paid_at: string;
}

/** Rupees charged per interval; yearly defaults to 10 x monthly (two months free). */
export function intervalPrice(plan: PublicPlan, interval: 'monthly' | 'yearly'): number {
  return interval === 'monthly' ? plan.price_inr_monthly : (plan.price_inr_yearly ?? plan.price_inr_monthly * 10);
}

/** The caller's own plan + usage and the public plans. Fails quietly (null) on error. */
export function useBilling() {
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [subscription, setSubscription] = useState<PublicSubscription | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/billing', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as {
        entitlements: Entitlements | null;
        plans: PublicPlan[];
        subscription?: PublicSubscription | null;
        payments?: PaymentRow[];
        payments_enabled?: boolean;
        payments_test_mode?: boolean;
      };
      setEntitlements(data.entitlements);
      setPlans(data.plans ?? []);
      setSubscription(data.subscription ?? null);
      setPayments(data.payments ?? []);
      setPaymentsEnabled(data.payments_enabled === true);
      setTestMode(data.payments_test_mode === true);
    } catch {
      // Billing info is advisory in the UI; the server enforces the rules.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { entitlements, plans, subscription, payments, paymentsEnabled, testMode, loading, refresh };
}

export function formatInr(amount: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}
