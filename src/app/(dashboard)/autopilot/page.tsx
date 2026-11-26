'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, Sparkles, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { DETAILING_SERVICES, VEHICLE_SIZES } from '@/lib/autopilot/car-detailing';
import type { AutopilotSetup } from '@/lib/autopilot/types';
import type { ApplyReport } from '@/lib/autopilot/apply';

interface ServiceDraft {
  enabled: boolean;
  prices: Record<string, string>;
  duration: string;
  warranty: string;
}

interface FormState {
  businessName: string;
  city: string;
  address: string;
  mapsLink: string;
  contactPhone: string;
  openingHours: string;
  languages: string;
  paymentMethods: string;
  pickupDrop: 'no' | 'free' | 'paid';
  pickupDropNote: string;
  doorstep: boolean;
  bookingAdvance: string;
  cancellationPolicy: string;
  currentOffer: string;
  highlights: string;
  googleReviewLink: string;
  instagram: string;
  tone: 'friendly' | 'premium';
  services: Record<string, ServiceDraft>;
}

const emptyService = (): ServiceDraft => ({ enabled: false, prices: {}, duration: '', warranty: '' });

const initialForm: FormState = {
  businessName: '',
  city: '',
  address: '',
  mapsLink: '',
  contactPhone: '',
  openingHours: '',
  languages: 'English',
  paymentMethods: 'UPI, Cash, Card',
  pickupDrop: 'no',
  pickupDropNote: '',
  doorstep: false,
  bookingAdvance: '',
  cancellationPolicy: '',
  currentOffer: '',
  highlights: '',
  googleReviewLink: '',
  instagram: '',
  tone: 'friendly',
  services: Object.fromEntries(DETAILING_SERVICES.map((s) => [s.id, emptyService()])),
};

const splitList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

function toAnswers(f: FormState) {
  const { services, languages, paymentMethods, ...rest } = f;
  return {
    ...rest,
    languages: splitList(languages),
    paymentMethods: splitList(paymentMethods),
    services: Object.entries(services)
      .filter(([, s]) => s.enabled)
      .map(([id, s]) => ({
        id,
        prices: Object.fromEntries(Object.entries(s.prices).filter(([, v]) => v.trim() !== '')),
        duration: s.duration,
        warranty: s.warranty,
      })),
  };
}

function fromAnswers(a: Record<string, unknown>): FormState {
  const str = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : '');
  const services = { ...initialForm.services };
  for (const raw of Array.isArray(a.services) ? a.services : []) {
    const s = raw as { id: string; prices?: Record<string, number>; duration?: string; warranty?: string };
    if (!services[s.id]) continue;
    services[s.id] = {
      enabled: true,
      prices: Object.fromEntries(Object.entries(s.prices ?? {}).map(([k, v]) => [k, String(v)])),
      duration: s.duration ?? '',
      warranty: s.warranty ?? '',
    };
  }
  return {
    ...initialForm,
    businessName: str('businessName'),
    city: str('city'),
    address: str('address'),
    mapsLink: str('mapsLink'),
    contactPhone: str('contactPhone'),
    openingHours: str('openingHours'),
    languages: Array.isArray(a.languages) ? (a.languages as string[]).join(', ') : initialForm.languages,
    paymentMethods: Array.isArray(a.paymentMethods) ? (a.paymentMethods as string[]).join(', ') : '',
    pickupDrop: a.pickupDrop === 'free' || a.pickupDrop === 'paid' ? a.pickupDrop : 'no',
    pickupDropNote: str('pickupDropNote'),
    doorstep: a.doorstep === true,
    bookingAdvance: str('bookingAdvance'),
    cancellationPolicy: str('cancellationPolicy'),
    currentOffer: str('currentOffer'),
    highlights: str('highlights'),
    googleReviewLink: str('googleReviewLink'),
    instagram: str('instagram'),
    tone: a.tone === 'premium' ? 'premium' : 'friendly',
    services,
  };
}

type TemplateStatus = 'pending' | 'ok' | 'error';

export default function AutopilotPage() {
  const t = useTranslations('Autopilot');
  const [form, setForm] = useState<FormState>(initialForm);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'preview' | 'apply' | 'templates' | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [setup, setSetup] = useState<AutopilotSetup | null>(null);
  const [report, setReport] = useState<ApplyReport | null>(null);
  const [templateStatus, setTemplateStatus] = useState<Record<string, { status: TemplateStatus; message?: string }>>({});
  const [appliedAt, setAppliedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/autopilot');
        const data = (await res.json().catch(() => ({}))) as {
          profile?: { answers?: Record<string, unknown>; generated?: AutopilotSetup; applied_at?: string | null } | null;
        };
        if (cancelled || !data.profile) return;
        if (data.profile.answers) setForm(fromAnswers(data.profile.answers));
        if (data.profile.generated?.systemPrompt) setSetup(data.profile.generated);
        setAppliedAt(data.profile.applied_at ?? null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setService = (id: string, patch: Partial<ServiceDraft>) =>
    setForm((f) => ({ ...f, services: { ...f.services, [id]: { ...(f.services[id] ?? emptyService()), ...patch } } }));

  async function run(mode: 'preview' | 'apply') {
    setBusy(mode);
    setErrors([]);
    try {
      const res = await fetch('/api/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: toAnswers(form), mode }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        setup?: AutopilotSetup;
        report?: ApplyReport;
        error?: string;
        errors?: string[];
      };
      if (!res.ok) {
        setErrors(data.errors ?? []);
        toast.error(data.error ?? t('failed'));
        return;
      }
      if (data.setup) setSetup(data.setup);
      if (mode === 'apply' && data.report) {
        setReport(data.report);
        setAppliedAt(new Date().toISOString());
        toast.success(t('applied'));
      }
    } finally {
      setBusy(null);
    }
  }

  async function submitTemplates() {
    if (!setup) return;
    setBusy('templates');
    try {
      for (const tpl of setup.templates) {
        setTemplateStatus((s) => ({ ...s, [tpl.name]: { status: 'pending' } }));
        const res = await fetch('/api/whatsapp/templates/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tpl),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setTemplateStatus((s) => ({
          ...s,
          [tpl.name]: res.ok ? { status: 'ok' } : { status: 'error', message: data.error ?? t('failed') },
        }));
      }
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const field = (key: keyof FormState, label: string, placeholder = '') => (
    <div className="space-y-1.5">
      <Label htmlFor={key}>{label}</Label>
      <Input
        id={key}
        value={form[key] as string}
        placeholder={placeholder}
        onChange={(e) => set(key, e.target.value as never)}
      />
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Sparkles className="h-6 w-6 text-primary" /> {t('title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        {appliedAt && (
          <Badge variant="secondary" className="mt-2">
            {t('lastApplied', { date: new Date(appliedAt).toLocaleString() })}
          </Badge>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('business.title')}</CardTitle>
          <CardDescription>{t('business.desc')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {field('businessName', t('business.name'), 'Shine Car Studio')}
          {field('city', t('business.city'), 'Hyderabad')}
          {field('address', t('business.address'), 'Road 12, Banjara Hills')}
          {field('mapsLink', t('business.maps'), 'https://maps.google.com/...')}
          {field('contactPhone', t('business.phone'), '+91 ...')}
          {field('openingHours', t('business.hours'), 'Mon–Sat 9am–8pm, Sunday closed')}
          {field('languages', t('business.languages'), 'English, Hindi')}
          {field('instagram', t('business.instagram'), '@yourstudio')}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('services.title')}</CardTitle>
          <CardDescription>{t('services.desc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {DETAILING_SERVICES.map((svc) => {
            const s = form.services[svc.id] ?? emptyService();
            return (
              <div key={svc.id} className="rounded-md border p-3">
                <label className="flex items-center gap-2 font-medium">
                  <Checkbox checked={s.enabled} onCheckedChange={(v) => setService(svc.id, { enabled: v === true })} />
                  {svc.name}
                </label>
                {s.enabled && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-5">
                    {VEHICLE_SIZES.map((size) => (
                      <div key={size} className="space-y-1">
                        <Label className="text-xs">{t(`services.size.${size}`)}</Label>
                        <Input
                          inputMode="numeric"
                          placeholder="₹"
                          value={s.prices[size] ?? ''}
                          onChange={(e) =>
                            setService(svc.id, { prices: { ...s.prices, [size]: e.target.value.replace(/[^\d]/g, '') } })
                          }
                        />
                      </div>
                    ))}
                    <div className="space-y-1">
                      <Label className="text-xs">{t('services.duration')}</Label>
                      <Input value={s.duration} placeholder="3 hours" onChange={(e) => setService(svc.id, { duration: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('services.warranty')}</Label>
                      <Input value={s.warranty} placeholder="—" onChange={(e) => setService(svc.id, { warranty: e.target.value })} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">{t('services.priceHint')}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('policies.title')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t('policies.pickup')}</Label>
            <div className="flex gap-2">
              {(['no', 'free', 'paid'] as const).map((v) => (
                <Button
                  key={v}
                  type="button"
                  size="sm"
                  variant={form.pickupDrop === v ? 'default' : 'outline'}
                  onClick={() => set('pickupDrop', v)}
                >
                  {t(`policies.pickupOption.${v}`)}
                </Button>
              ))}
            </div>
          </div>
          {field('pickupDropNote', t('policies.pickupNote'), 'Within 10 km')}
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.doorstep} onCheckedChange={(v) => set('doorstep', v)} />
            {t('policies.doorstep')}
          </label>
          {field('paymentMethods', t('policies.payment'), 'UPI, Cash, Card')}
          {field('bookingAdvance', t('policies.advance'), '₹500 for coatings')}
          {field('cancellationPolicy', t('policies.cancellation'), 'Free reschedule up to 24 hours before')}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('marketing.title')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {field('currentOffer', t('marketing.offer'), '10% off ceramic coating this month')}
          {field('googleReviewLink', t('marketing.review'), 'https://g.page/r/...')}
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="highlights">{t('marketing.highlights')}</Label>
            <Textarea
              id="highlights"
              rows={3}
              value={form.highlights}
              placeholder={t('marketing.highlightsPlaceholder')}
              onChange={(e) => set('highlights', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('marketing.tone')}</Label>
            <div className="flex gap-2">
              {(['friendly', 'premium'] as const).map((v) => (
                <Button key={v} type="button" size="sm" variant={form.tone === v ? 'default' : 'outline'} onClick={() => set('tone', v)}>
                  {t(`marketing.toneOption.${v}`)}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {errors.length > 0 && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <ul className="list-disc pl-5">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy !== null} onClick={() => run('preview')}>
          {busy === 'preview' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('preview')}
        </Button>
        <Button disabled={busy !== null} onClick={() => run('apply')}>
          {busy === 'apply' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('apply')}
        </Button>
      </div>

      {report && (
        <Card>
          <CardHeader>
            <CardTitle>{t('report.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <ReportLine ok={report.agent !== 'needs_key'} text={t(`report.agent.${report.agent}`)} />
            <ReportLine
              ok={report.knowledge.indexFailed === 0}
              text={t('report.knowledge', { ...report.knowledge })}
            />
            <ReportLine ok text={t('report.quickReplies', { ...report.quickReplies })} />
            <ReportLine ok text={t('report.tags', { ...report.tags })} />
            <ReportLine ok text={t(`report.pipeline.${report.pipeline}`)} />
            <p className="pt-2 text-muted-foreground">{t('report.autoReplyHint')}</p>
          </CardContent>
        </Card>
      )}

      {setup && (
        <Card>
          <CardHeader>
            <CardTitle>{t('result.title')}</CardTitle>
            <CardDescription>
              {t('result.counts', {
                docs: setup.knowledge.length,
                replies: setup.quickReplies.length,
                tags: setup.tags.length,
                templates: setup.templates.length,
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <details>
              <summary className="cursor-pointer font-medium">{t('result.prompt')}</summary>
              <pre className="mt-2 whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{setup.systemPrompt}</pre>
            </details>
            <details>
              <summary className="cursor-pointer font-medium">{t('result.knowledge')}</summary>
              {setup.knowledge.map((d) => (
                <div key={d.title} className="mt-2">
                  <p className="font-medium">{d.title}</p>
                  <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{d.content}</pre>
                </div>
              ))}
            </details>
            <details>
              <summary className="cursor-pointer font-medium">{t('result.quickReplies')}</summary>
              {setup.quickReplies.map((q) => (
                <div key={q.title} className="mt-2">
                  <p className="font-medium">{q.title}</p>
                  <p className="whitespace-pre-wrap text-muted-foreground">{q.content_text}</p>
                </div>
              ))}
            </details>
            <div>
              <p className="font-medium">{t('result.templates')}</p>
              <p className="mb-2 text-xs text-muted-foreground">{t('result.templatesHint')}</p>
              <ul className="space-y-2">
                {setup.templates.map((tpl) => {
                  const st = templateStatus[tpl.name];
                  return (
                    <li key={tpl.name} className="rounded-md border p-2">
                      <div className="flex items-center gap-2">
                        <code className="text-xs">{tpl.name}</code>
                        <Badge variant="outline">{tpl.category}</Badge>
                        {st?.status === 'pending' && <Loader2 className="h-4 w-4 animate-spin" />}
                        {st?.status === 'ok' && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                        {st?.status === 'error' && <XCircle className="h-4 w-4 text-destructive" />}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{tpl.body_text}</p>
                      {st?.message && <p className="mt-1 text-xs text-destructive">{st.message}</p>}
                    </li>
                  );
                })}
              </ul>
              <Button className="mt-3" variant="outline" disabled={busy !== null} onClick={submitTemplates}>
                {busy === 'templates' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('result.submitTemplates')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ReportLine({ ok, text }: { ok: boolean; text: string }) {
  return (
    <p className="flex items-start gap-2">
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
      ) : (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      )}
      {text}
    </p>
  );
}
