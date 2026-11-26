'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { trialDaysLeft, type Entitlements } from '@/lib/billing/entitlements';
import { formatInr } from '@/components/billing/use-billing';

interface AccountRow {
  id: string;
  name: string;
  created_at: string;
  owner_email: string | null;
  owner_name: string | null;
  entitlements: Entitlements | null;
}

interface PlanRow {
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
  sort_order: number;
  is_public: boolean;
}

interface PlatformSettings {
  signup_mode: 'open' | 'invite_only';
  trial_days: number;
  grace_days: number;
  default_plan_id: string;
}

async function call(url: string, init?: RequestInit): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

function statusBadge(e: Entitlements | null, t: ReturnType<typeof useTranslations>) {
  if (!e) return <Badge variant="outline">{t('noSubscription')}</Badge>;
  if (e.is_comped) return <Badge variant="secondary">{t('comped')}</Badge>;
  if (!e.writable) {
    return <Badge variant="destructive">{e.status === 'suspended' ? t('suspended') : t('expired')}</Badge>;
  }
  if (e.status === 'trialing') return <Badge variant="outline">{t('trialDays', { days: trialDaysLeft(e) })}</Badge>;
  return <Badge>{e.status}</Badge>;
}

function BusinessesTab({ plans }: { plans: PlanRow[] }) {
  const t = useTranslations('PlatformAdmin');
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const { ok, data } = await call('/api/platform/accounts');
      if (ok) setRows((data.accounts as AccountRow[]) ?? []);
      else toast.error((data.error as string) ?? t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, body: Record<string, unknown>) => {
    setBusy(id);
    const { ok, data } = await call(`/api/platform/accounts/${id}`, { method: 'POST', body: JSON.stringify(body) });
    setBusy(null);
    if (ok) {
      toast.success(t('saved'));
      await load();
    } else {
      toast.error((data.error as string) ?? t('saveFailed'));
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => `${r.name} ${r.owner_email ?? ''} ${r.owner_name ?? ''}`.toLowerCase().includes(q));
  }, [rows, query]);

  const counts = useMemo(() => {
    const live = rows.filter((r) => r.entitlements?.writable);
    return {
      total: rows.length,
      trial: rows.filter((r) => r.entitlements?.status === 'trialing' && r.entitlements.writable && !r.entitlements.is_comped).length,
      paying: rows.filter((r) => r.entitlements?.status === 'active' && !r.entitlements.is_comped).length,
      inactive: rows.length - live.length,
      mrr: rows
        .filter((r) => r.entitlements?.status === 'active' && !r.entitlements.is_comped)
        .reduce((sum, r) => sum + (r.entitlements?.plan.price_inr_monthly ?? 0), 0),
    };
  }, [rows]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loading')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-5">
        {[
          [t('statTotal'), counts.total],
          [t('statTrial'), counts.trial],
          [t('statPaying'), counts.paying],
          [t('statInactive'), counts.inactive],
          [t('statMrr'), formatInr(counts.mrr)],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-xl font-semibold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-2">
        <Input placeholder={t('search')} value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button variant="outline" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" /> {t('refresh')}
        </Button>
      </div>

      {filtered.length === 0 && <p className="text-sm text-muted-foreground">{t('noBusinesses')}</p>}

      <div className="space-y-3">
        {filtered.map((r) => {
          const e = r.entitlements;
          return (
            <Card key={r.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {r.name} {statusBadge(e, t)}
                  {e && <Badge variant="outline">{e.plan.name}</Badge>}
                </CardTitle>
                <CardDescription>
                  {r.owner_name ? `${r.owner_name} · ` : ''}
                  {r.owner_email ?? t('noOwnerEmail')} · {t('joined', { date: new Date(r.created_at).toLocaleDateString('en-IN') })}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {e && (
                  <p className="text-xs text-muted-foreground">
                    {t('usageLine', {
                      members: e.usage.members,
                      contacts: e.usage.contacts,
                      broadcasts: e.usage.broadcast_messages_monthly,
                      ai: e.usage.ai_replies_monthly,
                    })}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={e?.plan.id ?? ''}
                    disabled={busy === r.id}
                    onChange={(ev) => void act(r.id, { action: 'set_plan', plan_id: ev.target.value })}
                    aria-label={t('changePlan')}
                  >
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => void act(r.id, { action: 'extend_trial', days: 7 })}>
                    {t('extendTrial7')}
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => void act(r.id, { action: 'set_comped', value: !e?.is_comped })}>
                    {e?.is_comped ? t('removeComp') : t('makeComp')}
                  </Button>
                  {e?.status === 'suspended' ? (
                    <Button size="sm" disabled={busy === r.id} onClick={() => void act(r.id, { action: 'reactivate' })}>
                      {t('reactivate')}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy === r.id}
                      onClick={() => {
                        const reason = window.prompt(t('suspendPrompt'));
                        if (reason && reason.trim()) void act(r.id, { action: 'suspend', reason });
                      }}
                    >
                      {t('suspend')}
                    </Button>
                  )}
                  {busy === r.id && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

const PLAN_NUMBER_FIELDS: (keyof PlanRow)[] = [
  'price_inr_monthly',
  'max_members',
  'max_contacts',
  'max_broadcast_messages_monthly',
  'max_ai_replies_monthly',
  'max_voice_minutes_monthly',
];

function PlansTab({ plans, onSaved }: { plans: PlanRow[]; onSaved: () => void }) {
  const t = useTranslations('PlatformAdmin');
  // Unsaved edits per plan; a plan with no edits shows its saved values.
  const [edits, setEdits] = useState<Record<string, PlanRow>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const draftOf = (p: PlanRow): PlanRow => edits[p.id] ?? p;

  const save = async (id: string) => {
    const plan = plans.find((p) => p.id === id);
    const d = plan ? draftOf(plan) : undefined;
    if (!d) return;
    setSaving(id);
    const { ok, data } = await call('/api/platform/plans', {
      method: 'PATCH',
      body: JSON.stringify({
        id,
        name: d.name,
        description: d.description ?? '',
        is_public: d.is_public,
        ...Object.fromEntries(PLAN_NUMBER_FIELDS.map((f) => [f, Number(d[f])])),
        price_inr_yearly: d.price_inr_yearly === null ? null : Number(d.price_inr_yearly),
      }),
    });
    setSaving(null);
    if (ok) {
      toast.success(t('saved'));
      setEdits((all) => {
        const next = { ...all };
        delete next[id];
        return next;
      });
      onSaved();
    } else {
      toast.error((data.error as string) ?? t('saveFailed'));
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('plansHint')}</p>
      {plans.map((p) => {
        const d = draftOf(p);
        const set = (patch: Partial<PlanRow>) => setEdits((all) => ({ ...all, [p.id]: { ...d, ...patch } }));
        return (
          <Card key={p.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {p.name} <span className="text-xs font-normal text-muted-foreground">({p.id})</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>{t('planName')}</Label>
                  <Input value={d.name} onChange={(e) => set({ name: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>{t('planDescription')}</Label>
                  <Input value={d.description ?? ''} onChange={(e) => set({ description: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>{t('field_price_inr_yearly')}</Label>
                  <Input
                    type="number"
                    min={0}
                    placeholder={String(Number(d.price_inr_monthly) * 10)}
                    value={d.price_inr_yearly === null ? '' : String(d.price_inr_yearly)}
                    onChange={(e) => set({ price_inr_yearly: e.target.value === '' ? null : Number(e.target.value) })}
                  />
                </div>
                {PLAN_NUMBER_FIELDS.map((f) => (
                  <div key={f} className="space-y-1">
                    <Label>{t(`field_${f}`)}</Label>
                    <Input
                      type="number"
                      min={0}
                      value={String(d[f])}
                      onChange={(e) => set({ [f]: Number(e.target.value) } as Partial<PlanRow>)}
                    />
                  </div>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={d.is_public} onChange={(e) => set({ is_public: e.target.checked })} />
                {t('planPublic')}
              </label>
              <Button size="sm" disabled={saving === p.id} onClick={() => void save(p.id)}>
                {saving === p.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('savePlan')}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function SettingsTab({ plans }: { plans: PlanRow[] }) {
  const t = useTranslations('PlatformAdmin');
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [emails, setEmails] = useState<{ email: string; note: string | null }[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([call('/api/platform/settings'), call('/api/platform/allowlist')]);
      if (s.ok) setSettings(s.data.settings as PlatformSettings);
      if (a.ok) setEmails((a.data.emails as { email: string; note: string | null }[]) ?? []);
    } catch {
      toast.error(t('loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    // State is only set after the awaited fetches resolve (see `load`).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (!settings) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loading')}
      </div>
    );
  }

  const save = async () => {
    setSaving(true);
    const { ok, data } = await call('/api/platform/settings', { method: 'PATCH', body: JSON.stringify(settings) });
    setSaving(false);
    if (ok) toast.success(t('saved'));
    else toast.error((data.error as string) ?? t('saveFailed'));
  };

  const addEmail = async () => {
    const { ok, data } = await call('/api/platform/allowlist', { method: 'POST', body: JSON.stringify({ email: newEmail }) });
    if (ok) {
      setNewEmail('');
      await load();
    } else {
      toast.error((data.error as string) ?? t('saveFailed'));
    }
  };

  const removeEmail = async (email: string) => {
    const { ok } = await call(`/api/platform/allowlist?email=${encodeURIComponent(email)}`, { method: 'DELETE' });
    if (ok) await load();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('signupTitle')}</CardTitle>
          <CardDescription>{t('signupDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{t('signupMode')}</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={settings.signup_mode}
                onChange={(e) => setSettings({ ...settings, signup_mode: e.target.value as PlatformSettings['signup_mode'] })}
              >
                <option value="open">{t('signupOpen')}</option>
                <option value="invite_only">{t('signupInviteOnly')}</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>{t('defaultPlan')}</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={settings.default_plan_id}
                onChange={(e) => setSettings({ ...settings, default_plan_id: e.target.value })}
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>{t('trialDaysLabel')}</Label>
              <Input type="number" min={0} max={365} value={settings.trial_days} onChange={(e) => setSettings({ ...settings, trial_days: Number(e.target.value) })} />
            </div>
            <div className="space-y-1">
              <Label>{t('graceDaysLabel')}</Label>
              <Input type="number" min={0} max={60} value={settings.grace_days} onChange={(e) => setSettings({ ...settings, grace_days: Number(e.target.value) })} />
            </div>
          </div>
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('saveSettings')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('allowlistTitle')}</CardTitle>
          <CardDescription>{t('allowlistDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="owner@business.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            <Button onClick={() => void addEmail()} disabled={!newEmail.trim()}>
              {t('add')}
            </Button>
          </div>
          {emails.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('allowlistEmpty')}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {emails.map((e) => (
                <li key={e.email} className="flex items-center justify-between rounded border px-3 py-1.5">
                  {e.email}
                  <Button size="sm" variant="ghost" onClick={() => void removeEmail(e.email)}>
                    {t('remove')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** /admin — the GrowthXAi owner's console. Visible only to PLATFORM_ADMIN_EMAILS. */
export default function PlatformAdminPage() {
  const t = useTranslations('PlatformAdmin');
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);

  const loadPlans = useCallback(async () => {
    const { ok, data } = await call('/api/platform/plans');
    if (ok) setPlans((data.plans as PlanRow[]) ?? []);
  }, []);

  useEffect(() => {
    void (async () => {
      const { ok, data } = await call('/api/platform/me');
      const isAdmin = ok && data.isPlatformAdmin === true;
      setAllowed(isAdmin);
      if (isAdmin) await loadPlans();
    })();
  }, [loadPlans]);

  if (allowed === null) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loading')}
      </div>
    );
  }
  if (!allowed) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
        <ShieldAlert className="h-8 w-8" />
        <p>{t('notAllowed')}</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      <Tabs defaultValue="businesses" className="mt-6">
        <TabsList>
          <TabsTrigger value="businesses">{t('tabBusinesses')}</TabsTrigger>
          <TabsTrigger value="plans">{t('tabPlans')}</TabsTrigger>
          <TabsTrigger value="settings">{t('tabSettings')}</TabsTrigger>
        </TabsList>
        <TabsContent value="businesses" className="mt-4">
          <BusinessesTab plans={plans} />
        </TabsContent>
        <TabsContent value="plans" className="mt-4">
          <PlansTab plans={plans} onSaved={() => void loadPlans()} />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <SettingsTab plans={plans} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
