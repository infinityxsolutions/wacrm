'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Mail, Send, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createClient } from '@/lib/supabase/client';

interface Settings {
  from_name: string;
  reply_to_email: string;
  business_address: string;
}
interface Quota {
  limit: number;
  used: number;
  remaining: number | null;
  unlimited: boolean;
}
interface Campaign {
  id: string;
  name: string;
  subject: string;
  body_text: string;
  audience: { kind: 'all' } | { kind: 'tags'; tag_ids: string[] };
  status: 'draft' | 'sending' | 'sent' | 'failed';
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  sent_at: string | null;
  created_at: string;
}
interface Tag {
  id: string;
  name: string;
}

async function api(url: string, init?: RequestInit): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

const emptyDraft = { name: '', subject: '', body_text: '', tagIds: [] as string[] };

export default function EmailPage() {
  const t = useTranslations('EmailUi');
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [settings, setSettings] = useState<Settings>({ from_name: '', reply_to_email: '', business_address: '' });
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [status, list] = await Promise.all([api('/api/email/status'), api('/api/email/campaigns')]);
      if (status.ok) {
        const d = status.data as { enabled: boolean; settings: Settings | null; quota: Quota };
        setEnabled(d.enabled);
        setQuota(d.quota);
        if (d.settings) {
          setSettings(d.settings);
          setSettingsSaved(true);
        }
      }
      if (list.ok) setCampaigns((list.data as { campaigns: Campaign[] }).campaigns ?? []);
      const { data } = await createClient().from('tags').select('id, name').order('name');
      setTags((data ?? []) as Tag[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveSettings = async () => {
    setBusy('settings');
    const { ok, data } = await api('/api/email/settings', { method: 'PUT', body: JSON.stringify(settings) });
    setBusy(null);
    if (ok) {
      setSettingsSaved(true);
      toast.success(t('settingsSaved'));
    } else toast.error((data.error as string) ?? t('failed'));
  };

  const body = () => ({
    name: draft.name,
    subject: draft.subject,
    body_text: draft.body_text,
    audience: draft.tagIds.length ? { kind: 'tags', tag_ids: draft.tagIds } : { kind: 'all' },
  });

  /** Save the draft (create or update) and return its id, or null on failure. */
  const saveDraft = async (): Promise<string | null> => {
    const res = editingId
      ? await api(`/api/email/campaigns/${editingId}`, { method: 'PATCH', body: JSON.stringify(body()) })
      : await api('/api/email/campaigns', { method: 'POST', body: JSON.stringify(body()) });
    if (!res.ok) {
      toast.error((res.data.error as string) ?? t('failed'));
      return null;
    }
    const id = editingId ?? (res.data.id as string);
    setEditingId(id);
    return id;
  };

  const onSave = async () => {
    setBusy('save');
    const id = await saveDraft();
    setBusy(null);
    if (id) {
      toast.success(t('draftSaved'));
      await load();
    }
  };

  const onTest = async () => {
    setBusy('test');
    const id = await saveDraft();
    if (id) {
      const { ok, data } = await api(`/api/email/campaigns/${id}/test`, { method: 'POST' });
      if (ok) toast.success(t('testSent', { email: String(data.sent_to ?? '') }));
      else toast.error((data.error as string) ?? t('failed'));
    }
    setBusy(null);
  };

  const onSend = async () => {
    if (!window.confirm(t('sendConfirm'))) return;
    setBusy('send');
    const id = await saveDraft();
    if (id) {
      const { ok, data } = await api(`/api/email/campaigns/${id}/send`, { method: 'POST' });
      if (ok) {
        toast.success(t('sentResult', { sent: Number(data.sent ?? 0), failed: Number(data.failed ?? 0) }));
        setDraft(emptyDraft);
        setEditingId(null);
      } else toast.error((data.error as string) ?? t('failed'));
      await load();
    }
    setBusy(null);
  };

  const edit = (c: Campaign) => {
    setEditingId(c.id);
    setDraft({
      name: c.name,
      subject: c.subject,
      body_text: c.body_text,
      tagIds: c.audience.kind === 'tags' ? c.audience.tag_ids : [],
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const remove = async (c: Campaign) => {
    if (!window.confirm(t('deleteConfirm'))) return;
    const { ok, data } = await api(`/api/email/campaigns/${c.id}`, { method: 'DELETE' });
    if (ok) {
      if (editingId === c.id) {
        setEditingId(null);
        setDraft(emptyDraft);
      }
      await load();
    } else toast.error((data.error as string) ?? t('failed'));
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const canCompose = enabled && settingsSaved;
  const ready = draft.name.trim() && draft.subject.trim() && draft.body_text.trim();

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Mail className="h-6 w-6 text-primary" /> {t('title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        {quota && (
          <Badge variant="secondary" className="mt-2">
            {quota.unlimited ? t('quotaUnlimited', { used: quota.used }) : t('quota', { used: quota.used, limit: quota.limit })}
          </Badge>
        )}
        {!enabled && <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">{t('notEnabled')}</p>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('sender.title')}</CardTitle>
          <CardDescription>{t('sender.desc')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="from_name">{t('sender.fromName')}</Label>
            <Input id="from_name" value={settings.from_name} maxLength={80} onChange={(e) => setSettings({ ...settings, from_name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reply_to">{t('sender.replyTo')}</Label>
            <Input id="reply_to" type="email" value={settings.reply_to_email} onChange={(e) => setSettings({ ...settings, reply_to_email: e.target.value })} />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="address">{t('sender.address')}</Label>
            <Input id="address" value={settings.business_address} maxLength={300} placeholder={t('sender.addressPlaceholder')} onChange={(e) => setSettings({ ...settings, business_address: e.target.value })} />
            <p className="text-xs text-muted-foreground">{t('sender.addressHint')}</p>
          </div>
          <div>
            <Button size="sm" disabled={busy !== null} onClick={() => void saveSettings()}>
              {busy === 'settings' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('sender.save')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{editingId ? t('compose.editTitle') : t('compose.title')}</CardTitle>
          <CardDescription>{t('compose.desc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canCompose && <p className="text-sm text-muted-foreground">{enabled ? t('compose.needSettings') : t('notEnabled')}</p>}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="c_name">{t('compose.name')}</Label>
              <Input id="c_name" value={draft.name} maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c_subject">{t('compose.subject')}</Label>
              <Input id="c_subject" value={draft.subject} maxLength={200} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c_body">{t('compose.body')}</Label>
            <Textarea id="c_body" rows={8} value={draft.body_text} onChange={(e) => setDraft({ ...draft, body_text: e.target.value })} />
            <p className="text-xs text-muted-foreground">{t.raw('compose.variables')}</p>
          </div>
          <div className="space-y-1.5">
            <Label>{t('compose.audience')}</Label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant={draft.tagIds.length === 0 ? 'default' : 'outline'} onClick={() => setDraft({ ...draft, tagIds: [] })}>
                {t('compose.everyone')}
              </Button>
              {tags.map((tag) => {
                const on = draft.tagIds.includes(tag.id);
                return (
                  <Button
                    key={tag.id}
                    type="button"
                    size="sm"
                    variant={on ? 'default' : 'outline'}
                    onClick={() => setDraft({ ...draft, tagIds: on ? draft.tagIds.filter((x) => x !== tag.id) : [...draft.tagIds, tag.id] })}
                  >
                    {tag.name}
                  </Button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">{t('compose.audienceHint')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy !== null || !ready} onClick={() => void onSave()}>
              {busy === 'save' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('compose.saveDraft')}
            </Button>
            <Button variant="outline" disabled={busy !== null || !ready || !canCompose} onClick={() => void onTest()}>
              {busy === 'test' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('compose.sendTest')}
            </Button>
            <Button disabled={busy !== null || !ready || !canCompose} onClick={() => void onSend()}>
              {busy === 'send' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              {t('compose.send')}
            </Button>
            {editingId && (
              <Button variant="ghost" onClick={() => { setEditingId(null); setDraft(emptyDraft); }}>
                {t('compose.new')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('history.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('history.empty')}</p>
          ) : (
            <ul className="divide-y">
              {campaigns.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{c.subject}</p>
                    {c.status !== 'draft' && (
                      <p className="text-xs text-muted-foreground">
                        {t('history.counts', { sent: c.sent_count, failed: c.failed_count })}
                        {c.sent_at ? ` · ${new Date(c.sent_at).toLocaleDateString('en-IN')}` : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={c.status === 'failed' ? 'destructive' : c.status === 'sent' ? 'secondary' : 'outline'}>{t(`status.${c.status}`)}</Badge>
                    {c.status === 'draft' && (
                      <Button size="sm" variant="outline" onClick={() => edit(c)}>
                        {t('history.edit')}
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" aria-label={t('history.delete')} onClick={() => void remove(c)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
