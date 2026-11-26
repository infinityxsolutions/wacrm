'use client';

import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { trialDaysLeft, type Entitlements } from '@/lib/billing/entitlements';
import { formatInr, useBilling } from '@/components/billing/use-billing';
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
  const { entitlements: e, plans, loading } = useBilling();

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
            </CardContent>
          </Card>

          <div>
            <h3 className="mb-3 text-sm font-semibold">{t('plansTitle')}</h3>
            <div className="grid gap-4 md:grid-cols-3">
              {plans.map((p) => (
                <Card key={p.id} className={p.id === e.plan.id ? 'border-primary' : undefined}>
                  <CardHeader>
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    <CardDescription>{p.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    <p className="text-xl font-semibold">
                      {formatInr(p.price_inr_monthly)}
                      <span className="text-sm font-normal text-muted-foreground"> {t('perMonth')}</span>
                    </p>
                    <p>{t('planMembers', { n: p.max_members })}</p>
                    <p>{t('planContacts', { n: p.max_contacts.toLocaleString('en-IN') })}</p>
                    <p>{t('planBroadcasts', { n: p.max_broadcast_messages_monthly.toLocaleString('en-IN') })}</p>
                    <p>{t('planAi', { n: p.max_ai_replies_monthly.toLocaleString('en-IN') })}</p>
                    {p.id === e.plan.id && <Badge variant="outline">{t('currentPlan')}</Badge>}
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{t('upgradeSoon')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
