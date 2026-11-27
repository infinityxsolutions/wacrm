'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { trialDaysLeft, type Entitlements } from '@/lib/billing/entitlements';
import { formatInr, intervalPrice, useBilling } from '@/components/billing/use-billing';
import { SettingsPanelHead } from './settings-panel-head';

type UsageKey = 'members' | 'contacts' | 'broadcast_messages_monthly' | 'ai_replies_monthly';
const USAGE_ROWS: UsageKey[] = ['members', 'contacts', 'broadcast_messages_monthly', 'ai_replies_monthly'];

function UsageBar({ used, limit, comped }: { used: number; limit: number; comped: boolean }) {
  const pct = comped || limit <= 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={`h-full rounded-full ${pct >= 90 ? 'bg-destructive' : 'bg-primary'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function statusLabel(e: Entitlements, t: ReturnType<typeof useTranslations>): string {
  if (e.is_comped) return t('statusComped');
  if (!e.writable) return e.status === 'suspended' ? t('statusSuspended') : t('statusExpired');
  if (e.status === 'trialing') return t('statusTrial', { days: trialDaysLeft(e) });
  return t(`status_${e.status}`);
}

/** Settings → Plan & billing: current plan, status, this month's usage and the plans on offer. */
export function BillingPanel() {
  const t = useTranslations('BillingUi');
  const { entitlements: e, plans, subscription, payments, paymentsEnabled, testMode, loading, refresh } = useBilling();
  const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly');
  const [busy, setBusy] = useState<string | null>(null);

  const choose = async (planId: string) => {
    setBusy(planId);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: planId, interval }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && data.url) {
        toast.message(t('redirecting'));
        window.location.assign(data.url);
        return;
      }
      toast.error(data.error ?? t('payFailed'));
    } catch {
      toast.error(t('payFailed'));
    }
    setBusy(null);
  };

  const cancel = async () => {
    if (!window.confirm(t('cancelConfirm'))) return;
    setBusy('cancel');
    try {
      const res = await fetch('/api/billing/cancel', { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        toast.success(t('cancelled'));
        await refresh();
      } else {
        toast.error(data.error ?? t('cancelFailed'));
      }
    } catch {
      toast.error(t('cancelFailed'));
    }
    setBusy(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loading')}
      </div>
    );
  }

  return (
    <div>
      <SettingsPanelHead title={t('title')} description={t('description')} />
      {!e ? (
        <p className="text-sm text-muted-foreground">{t('unavailable')}</p>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {e.plan.name}
                <Badge variant={e.writable ? 'secondary' : 'destructive'}>{statusLabel(e, t)}</Badge>
              </CardTitle>
              <CardDescription>
                {e.is_comped ? t('compedDesc') : t('priceLine', { price: formatInr(e.plan.price_inr_monthly) })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {USAGE_ROWS.map((key) => {
                const used = key === 'members' ? e.usage.members + e.usage.pending_invitations : e.usage[key];
                const limit = e.limits[key];
                return (
                  <div key={key} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span>{t(`usage_${key}`)}</span>
                      <span className="text-muted-foreground">
                        {e.is_comped ? t('unlimited') : `${used.toLocaleString('en-IN')} / ${limit.toLocaleString('en-IN')}`}
                      </span>
                    </div>
                    <UsageBar used={used} limit={limit} comped={e.is_comped} />
                  </div>
                );
              })}
              <p className="text-xs text-muted-foreground">{t('usageNote')}</p>
              {!e.is_comped && e.current_period_end && subscription?.has_paid_subscription && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
                  <span>
                    {subscription.billing_interval === 'yearly' ? t('billedYearly') : t('billedMonthly')}
                    {' · '}
                    {subscription.cancel_at_period_end || e.status === 'canceled'
                      ? t('endsOn', { date: new Date(e.current_period_end).toLocaleDateString('en-IN') })
                      : t('renews', { date: new Date(e.current_period_end).toLocaleDateString('en-IN') })}
                  </span>
                  {e.status !== 'canceled' && !subscription.cancel_at_period_end && (
                    <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void cancel()}>
                      {busy === 'cancel' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {t('cancelPlan')}
                    </Button>
                  )}
                </div>
              )}
              {e.status === 'trialing' && subscription?.has_paid_subscription && (
                <Button variant="outline" size="sm" onClick={() => void refresh()}>
                  {t('refreshStatus')}
                </Button>
              )}
            </CardContent>
          </Card>

          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t('plansTitle')}</h3>
              <div className="inline-flex rounded-md border p-0.5 text-sm">
                {(['monthly', 'yearly'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setInterval(v)}
                    className={`rounded px-3 py-1 ${interval === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                  >
                    {t(v)}
                    {v === 'yearly' && <span className="ml-1 text-xs opacity-80">· {t('yearlyHint')}</span>}
                  </button>
                ))}
              </div>
            </div>
            {testMode && <p className="mb-3 rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">{t('testMode')}</p>}
            <div className="grid gap-4 md:grid-cols-3">
              {plans.map((p) => (
                <Card key={p.id} className={p.id === e.plan.id ? 'border-primary' : undefined}>
                  <CardHeader>
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    <CardDescription>{p.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    <p className="text-xl font-semibold">
                      {formatInr(intervalPrice(p, interval))}
                      <span className="text-sm font-normal text-muted-foreground">
                        {' '}
                        {interval === 'yearly' ? t('perYear') : t('perMonth')}
                      </span>
                    </p>
                    <p>{t('planMembers', { n: p.max_members })}</p>
                    <p>{t('planContacts', { n: p.max_contacts.toLocaleString('en-IN') })}</p>
                    <p>{t('planBroadcasts', { n: p.max_broadcast_messages_monthly.toLocaleString('en-IN') })}</p>
                    <p>{t('planAi', { n: p.max_ai_replies_monthly.toLocaleString('en-IN') })}</p>
                    <p>{t('planEmails', { n: p.max_emails_monthly.toLocaleString('en-IN') })}</p>
                    {p.id === e.plan.id && <Badge variant="outline">{t('currentPlan')}</Badge>}
                    {paymentsEnabled && !e.is_comped && !subscription?.has_paid_subscription && (
                      <Button className="mt-2 w-full" size="sm" disabled={busy !== null} onClick={() => void choose(p.id)}>
                        {busy === p.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {t('choosePlan')}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
            {e.is_comped ? (
              <p className="mt-3 text-sm text-muted-foreground">{t('compedNoPay')}</p>
            ) : (
              !paymentsEnabled && <p className="mt-3 text-sm text-muted-foreground">{t('contactToUpgrade')}</p>
            )}
          </div>

          {payments.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold">{t('history')}</h3>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">{t('colDate')}</th>
                      <th className="px-3 py-2">{t('colAmount')}</th>
                      <th className="px-3 py-2">{t('colMethod')}</th>
                      <th className="px-3 py-2">{t('colStatus')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((pay) => (
                      <tr key={pay.id} className="border-t">
                        <td className="px-3 py-2">{new Date(pay.paid_at).toLocaleDateString('en-IN')}</td>
                        <td className="px-3 py-2">{formatInr(pay.amount_paise / 100)}</td>
                        <td className="px-3 py-2">{pay.method ?? '—'}</td>
                        <td className="px-3 py-2">{pay.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
