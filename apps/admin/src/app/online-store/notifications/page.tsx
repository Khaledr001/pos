"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Mail, MessageCircle, RefreshCw, Save, Send, Undo2 } from "lucide-react";
import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_LABELS,
  WHATSAPP_TEMPLATE_DEFS,
  resolveNotificationSettings,
  type NotificationEvent,
  type NotificationOverview,
  type StorefrontNotificationSettings,
  type TemplateApprovalState,
} from "@devsfleet/shared-types";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { usePermission } from "@/lib/require-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { Field, Loading, Notice, PageHeader, errorText } from "../shared";
import { StoreTabs } from "../store-nav";
import { useStoreSettings } from "../use-store-settings";
import { DeliveryLog } from "./delivery-log";

const POLL_MS = 30_000;
const TEMPLATE_NAME = /^[a-z0-9_]{1,100}$/;
const LANGUAGES = [
  { value: "en", label: "English (en)" },
  { value: "en_US", label: "English US (en_US)" },
  { value: "en_GB", label: "English UK (en_GB)" },
  { value: "ar", label: "Arabic (ar)" },
  { value: "ur", label: "Urdu (ur)" },
  { value: "hi", label: "Hindi (hi)" },
  { value: "bn", label: "Bengali (bn)" },
];

const STATE_TONE: Record<TemplateApprovalState, "success" | "warning" | "destructive" | "secondary"> = {
  approved: "success",
  pending: "warning",
  rejected: "destructive",
  paused: "secondary",
  missing: "secondary",
};

/** Header/line-break characters would let a shop name inject mail headers; angle brackets break the From address. */
const BAD_SENDER = /[\r\n<>]/;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export default function NotificationsPage() {
  const { tokens } = useAuth();
  const auth = useMemo(() => ({ accessToken: tokens?.accessToken }), [tokens]);
  const mayWrite = usePermission("storefront:write");
  const { overview: store, settings, loading: storeLoading, saving, error, success, setError, setSuccess, patch } = useStoreSettings();

  const [live, setLive] = useState<NotificationOverview | null>(null);
  const [loadingLive, setLoadingLive] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [draft, setDraft] = useState<StorefrontNotificationSettings | null>(null);

  const loadLive = useCallback(async () => {
    setLoadingLive(true);
    try {
      setLive(await api.get<NotificationOverview>("/storefront-admin/notifications", auth));
    } catch (err) {
      setError(errorText(err, "Failed to load notification status."));
    } finally {
      setLoadingLive(false);
    }
  }, [auth, setError]);

  useEffect(() => {
    void loadLive();
  }, [loadLive]);

  // Meta approves templates in minutes to a day; one check every 30s while any is pending is plenty.
  const anyPending = !!live?.whatsapp.templates.some((t) => t.state === "pending");
  useEffect(() => {
    if (!anyPending) return;
    const id = setInterval(() => void loadLive(), POLL_MS);
    return () => clearInterval(id);
  }, [anyPending, loadLive]);

  const saved = useMemo(() => (settings ? resolveNotificationSettings(settings.notifications) : null), [settings]);
  useEffect(() => {
    if (saved) setDraft(structuredClone(saved));
  }, [saved]);

  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);
  const problems = useMemo(() => {
    if (!draft) return [];
    const out: string[] = [];
    if (draft.fromName && BAD_SENDER.test(draft.fromName)) out.push("The sender name cannot contain line breaks or < >.");
    if (draft.replyTo && !EMAIL.test(draft.replyTo)) out.push("Reply-to must be a valid email address.");
    for (const e of NOTIFICATION_EVENTS) {
      const t = draft.whatsappTemplates[e];
      if (t && !TEMPLATE_NAME.test(t.name)) out.push(`${NOTIFICATION_EVENT_LABELS[e]}: template names use lowercase letters, digits and underscores only.`);
    }
    return out;
  }, [draft]);

  const stateOf = useCallback(
    (e: NotificationEvent) => live?.whatsapp.templates.find((t) => t.event === e),
    [live],
  );

  if (storeLoading || (loadingLive && !live)) return <Loading label="Loading notifications..." />;
  if (!store?.storefront || !draft || !live) {
    return (
      <div className="space-y-6">
        <PageHeader title="Notifications" description="Order, quote and stock messages to your shoppers." />
        <StoreTabs current="/online-store/notifications" />
        {error && <Notice kind="error" message={error} onClose={() => setError(null)} />}
        <Card className="p-6 text-sm text-muted-foreground">
          {store?.storefront ? "Could not load notification status. Try refreshing." : "Create your online store first, in Store Settings."}
        </Card>
      </div>
    );
  }

  const sync = async () => {
    setSyncing(true);
    setError(null);
    try {
      setLive(await api.post<NotificationOverview>("/storefront-admin/notifications/templates/sync", {}, auth));
      setSuccess("Templates submitted. Meta usually approves them within minutes, sometimes up to a day.");
    } catch (err) {
      setError(errorText(err, "Could not sync WhatsApp templates."));
    } finally {
      setSyncing(false);
    }
  };

  const save = async () => {
    const ok = await patch(
      {
        notifications: {
          ...draft,
          fromName: draft.fromName?.trim() || undefined,
          replyTo: draft.replyTo?.trim() || undefined,
        },
      },
      "Notification settings saved.",
    );
    if (ok) void loadLive();
  };

  const setRule = (e: NotificationEvent, channel: "email" | "whatsapp", on: boolean) =>
    setDraft({ ...draft, events: { ...draft.events, [e]: { ...draft.events[e], [channel]: on } } });

  const setTemplate = (e: NotificationEvent, patchRef: { name?: string; language?: string } | null) => {
    const next = { ...draft.whatsappTemplates };
    if (patchRef === null) delete next[e];
    else next[e] = { name: patchRef.name ?? next[e]?.name ?? WHATSAPP_TEMPLATE_DEFS[e].name, language: patchRef.language ?? next[e]?.language ?? "en" };
    setDraft({ ...draft, whatsappTemplates: next });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Notifications" description="Order updates, trade quotes and back-in-stock messages, by email and WhatsApp.">
        {mayWrite && (
          <>
            <Button size="sm" variant="outline" disabled={!dirty || saving} onClick={() => saved && setDraft(structuredClone(saved))}><Undo2 className="h-4 w-4" /> Discard</Button>
            <Button size="sm" disabled={!dirty || saving || problems.length > 0} onClick={() => void save()}><Save className="h-4 w-4" /> Save</Button>
          </>
        )}
      </PageHeader>
      <StoreTabs current="/online-store/notifications" />

      {success && <Notice kind="success" message={success} onClose={() => setSuccess(null)} />}
      {error && <Notice kind="error" message={error} onClose={() => setError(null)} />}
      {problems.length > 0 && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <ul className="list-disc space-y-0.5 pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-1.5 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold"><Mail className="h-4 w-4" /> Email</div>
          {live.email.configured ? (
            <p className="text-xs text-muted-foreground">Ready. Mail is sent as <span className="font-mono text-foreground">{live.email.from ?? "your platform address"}</span>.</p>
          ) : (
            <p className="text-xs text-muted-foreground">Email sending is not set up on this platform yet. Ask your platform admin to configure the SMTP transport; until then email messages are recorded as skipped.</p>
          )}
          <Badge variant={live.email.configured ? "success" : "warning"}>{live.email.configured ? "Configured" : "Not configured"}</Badge>
        </Card>
        <Card className="space-y-1.5 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold"><MessageCircle className="h-4 w-4" /> WhatsApp</div>
          {live.whatsapp.connected ? (
            <p className="text-xs text-muted-foreground">Your WhatsApp Business account is connected. Messages outside a 24-hour chat go out as approved templates.</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              No WhatsApp Business account is connected. <Link href="/whatsapp" className="font-medium text-primary underline">Connect one</Link> to send order updates on WhatsApp.
            </p>
          )}
          <Badge variant={live.whatsapp.connected ? "success" : "warning"}>{live.whatsapp.connected ? "Connected" : "Not connected"}</Badge>
        </Card>
      </div>

      <fieldset disabled={!mayWrite} className="min-w-0 space-y-6">
        <Card className="space-y-4 p-5">
          <h2 className="text-sm font-semibold">Sender</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="From name" hint="Shown as the sender. Leave empty to use your shop name.">
              <Input maxLength={80} value={draft.fromName ?? ""} onChange={(e) => setDraft({ ...draft, fromName: e.target.value })} placeholder={settings?.displayName ?? ""} />
            </Field>
            <Field label="Reply-to address" hint="Where a shopper's reply lands. Leave empty to use your business email.">
              <Input type="email" maxLength={200} value={draft.replyTo ?? ""} onChange={(e) => setDraft({ ...draft, replyTo: e.target.value })} placeholder="orders@yourshop.com" />
            </Field>
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-sm font-semibold">What gets sent</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Order messages go on WhatsApp only to shoppers who ticked “send my order updates on WhatsApp”; back-in-stock goes only to shoppers who gave a phone number.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Event</th>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">WhatsApp</th>
                </tr>
              </thead>
              <tbody>
                {NOTIFICATION_EVENTS.map((e) => {
                  const t = stateOf(e);
                  const waBlocked = !live.whatsapp.connected ? "Connect WhatsApp first." : t?.state !== "approved" ? "Needs an approved template (see below)." : null;
                  return (
                    <tr key={e} className="border-b border-border/60 last:border-0">
                      <td className="py-2.5 pr-4 font-medium text-foreground">{NOTIFICATION_EVENT_LABELS[e]}</td>
                      <td className="px-4 py-2.5">
                        <input type="checkbox" className="h-4 w-4" aria-label={`${NOTIFICATION_EVENT_LABELS[e]} by email`} checked={draft.events[e].email} onChange={(ev) => setRule(e, "email", ev.target.checked)} />
                      </td>
                      <td className="px-4 py-2.5">
                        <label className="flex items-center gap-2" title={waBlocked ?? undefined}>
                          <input type="checkbox" className="h-4 w-4" aria-label={`${NOTIFICATION_EVENT_LABELS[e]} on WhatsApp`} disabled={!!waBlocked && !draft.events[e].whatsapp} checked={draft.events[e].whatsapp} onChange={(ev) => setRule(e, "whatsapp", ev.target.checked)} />
                          {waBlocked && <span className="text-[11px] text-muted-foreground">{waBlocked}</span>}
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
            <div>
              <h2 className="text-sm font-semibold">WhatsApp templates</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                WhatsApp only allows a business to start a chat with an approved template. Meta approval takes minutes to a day; this page re-checks every 30 seconds while any template is pending.
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" disabled={loadingLive} onClick={() => void loadLive()}><RefreshCw className={`h-4 w-4 ${loadingLive ? "animate-spin" : ""}`} /> Refresh</Button>
              <Button type="button" size="sm" disabled={!mayWrite || !live.whatsapp.connected || syncing} onClick={() => void sync()}>{syncing ? "Submitting…" : "Create & sync templates"}</Button>
            </div>
          </div>
          <div className="space-y-3">
            {NOTIFICATION_EVENTS.map((e) => {
              const t = stateOf(e);
              const def = WHATSAPP_TEMPLATE_DEFS[e];
              const mapped = draft.whatsappTemplates[e];
              return (
                <details key={e} className="rounded-lg border border-border p-3">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="min-w-40 font-semibold text-foreground">{NOTIFICATION_EVENT_LABELS[e]}</span>
                    <span className="font-mono text-muted-foreground">{t?.name ?? def.name} · {t?.language ?? def.language}</span>
                    <Badge variant={STATE_TONE[t?.state ?? "missing"]}>{t?.state ?? "missing"}</Badge>
                    {t?.reason && <span className="text-destructive">{t.reason}</span>}
                  </summary>
                  <div className="mt-3 space-y-3 text-xs">
                    <div className="rounded-lg bg-muted/40 p-3">
                      <div className="mb-1 font-medium text-foreground">Preview ({def.category.toLowerCase()})</div>
                      <p>{def.body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => def.examples[Number(n) - 1] ?? "")}</p>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Variables, in order: {def.variables.map((v, i) => `{{${i + 1}}} ${v}`).join(" · ")}
                      </p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-[1fr_12rem_auto] md:items-end">
                      <Field label="Use a different approved template" hint="Must take exactly the variables above, in that order.">
                        <Input maxLength={100} value={mapped?.name ?? ""} placeholder={def.name} onChange={(ev) => (ev.target.value ? setTemplate(e, { name: ev.target.value.trim() }) : setTemplate(e, null))} />
                      </Field>
                      <Field label="Language">
                        <SelectField size="sm" label={`${NOTIFICATION_EVENT_LABELS[e]} template language`} value={mapped?.language ?? "en"} disabled={!mapped} onValueChange={(v) => setTemplate(e, { language: v })} options={LANGUAGES} />
                      </Field>
                      {mapped && <Button type="button" size="sm" variant="ghost" onClick={() => setTemplate(e, null)}>Use default</Button>}
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">Changes to template names are saved with the Save button at the top.</p>
        </Card>
      </fieldset>

      <TestSend auth={auth} mayWrite={mayWrite} whatsappConnected={live.whatsapp.connected} />
      <DeliveryLog auth={auth} mayWrite={mayWrite} />
    </div>
  );
}

function TestSend({ auth, mayWrite, whatsappConnected }: { auth: { accessToken: string | undefined }; mayWrite: boolean; whatsappConnected: boolean }) {
  const [channel, setChannel] = useState<"email" | "whatsapp">("email");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const valid = channel === "email" ? EMAIL.test(to.trim()) : /^\+?\d[\d\s-]{7,18}$/.test(to.trim());

  const send = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await api.post<{ ok: boolean; error: string | null }>("/storefront-admin/notifications/test", { channel, to: to.trim() }, auth);
      setResult(res.ok ? { ok: true, text: "Test message sent." } : { ok: false, text: res.error ?? "The test message could not be sent." });
    } catch (err) {
      setResult({ ok: false, text: errorText(err, "The test message could not be sent.") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3 p-5">
      <h2 className="text-sm font-semibold">Send a test</h2>
      <p className="text-xs text-muted-foreground">Sends a sample order message to you so you can see how it looks. Limited to 5 tests an hour.</p>
      <div className="grid gap-3 md:grid-cols-[10rem_1fr_auto] md:items-end">
        <Field label="Channel">
          <SelectField size="sm" label="Test channel" value={channel} onValueChange={(v) => { setChannel(v as "email" | "whatsapp"); setTo(""); setResult(null); }} options={[{ value: "email", label: "Email" }, { value: "whatsapp", label: "WhatsApp", disabled: !whatsappConnected }]} />
        </Field>
        <Field label={channel === "email" ? "Email address" : "Phone number (with country code)"}>
          <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder={channel === "email" ? "you@example.com" : "+971501234567"} />
        </Field>
        <Button type="button" size="sm" disabled={!mayWrite || !valid || busy} onClick={() => void send()}><Send className="h-4 w-4" /> {busy ? "Sending…" : "Send test"}</Button>
      </div>
      {result && <p role="status" className={`text-xs ${result.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>{result.text}</p>}
    </Card>
  );
}
