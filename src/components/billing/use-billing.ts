'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Entitlements } from '@/lib/billing/entitlements';

export interface PublicPlan {
  id: string;
  name: string;
  description: string | null;
  price_inr_monthly: number;
  max_members: number;
  max_contacts: number;
  max_broadcast_messages_monthly: number;
  max_ai_replies_monthly: number;
  max_voice_minutes_monthly: number;
}

/** The caller's own plan + usage and the public plans. Fails quietly (null) on error. */
export function useBilling() {
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/billing', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { entitlements: Entitlements | null; plans: PublicPlan[] };
      setEntitlements(data.entitlements);
      setPlans(data.plans ?? []);
    } catch {
      // Billing info is advisory in the UI; the server enforces the rules.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { entitlements, plans, loading, refresh };
}

export function formatInr(amount: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}
