"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { usePermission } from "@/lib/require-auth";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * WhatsApp: configuration and the human inbox.
 *
 * This page replaced a hardcoded mockup — the threads it showed were a
 * constant in the file, and the only network call it made was to
 * `/quotations`. Everything below is real data from `/whatsapp/*`.
 *
 * The AI half of Phase 4 does not exist yet, so nothing here claims to be
 * automated: messages arrive from the webhook and a person answers them.
 */

interface Account {
  id: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  businessAccountId: string | null;
  isActive: boolean;
  hasAccessToken: boolean;
  hasAppSecret: boolean;
  hasVerifyToken: boolean;
}

interface Conversation {
  id: string;
  phoneNumber: string;
  profileName: string | null;
  status: string;
  lastMessageAt: string | null;
  windowExpiresAt: string | null;
}

interface WaMessage {
  id: string;
  direction: "inbound" | "outbound";
  content: string | null;
  status: string | null;
  errorMessage: string | null;
  occurredAt: string;
  isAiGenerated: boolean;
}

interface ConversationDetail extends Conversation {
  windowOpen: boolean;
  messages: WaMessage[];
}

export default function WhatsappPage() {
  const { tokens } = useAuth();
  const accessToken = tokens?.accessToken;
  const canConfigure = usePermission("settings:write");
  const canReply = usePermission("whatsapp:reply");

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [accountRows, convos] = await Promise.all([
        api.get<Account[]>("/whatsapp/accounts", { accessToken }).catch(() => [] as Account[]),
        api.get<{ items: Conversation[] }>("/whatsapp/conversations", {
          accessToken,
          query: { pageSize: 50 },
        }),
      ]);
      setAccounts(accountRows ?? []);
      setConversations(convos.items ?? []);
    } catch (err: any) {
      setError(err?.message || "Could not load WhatsApp data.");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!accessToken || !selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const row = await api.get<ConversationDetail>(
          `/whatsapp/conversations/${selectedId}`,
          { accessToken },
        );
        if (!cancelled) setDetail(row);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Could not open that conversation.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, accessToken]);

  const configured = accounts.some((a) => a.isActive);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <MessageSquare className="size-5 text-primary" aria-hidden="true" />
            WhatsApp
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Customer conversations from your business number.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-3.5" aria-hidden="true" />
            )}
            Refresh
          </Button>
          {canConfigure && (
            <Button variant="outline" size="sm" onClick={() => setSetupOpen(true)}>
              <Settings2 className="size-3.5" aria-hidden="true" />
              Setup
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/*
        The blocking state, said plainly.
        Without an account row the webhook rejects Meta's handshake outright,
        so "no conversations" would otherwise read as "nobody has messaged"
        when the truth is that nothing can arrive at all.
      */}
      {!loading && !configured && (
        <Card className="space-y-3 p-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-amber-500" aria-hidden="true" />
            <h2 className="text-sm font-semibold">No WhatsApp number is connected yet</h2>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Messages cannot arrive until a Meta Cloud API number is registered here. The
            webhook rejects Meta&apos;s verification handshake while no account exists, so
            the subscription cannot even be completed.
          </p>
          <ol className="max-w-2xl list-decimal space-y-1.5 pl-5 text-xs text-muted-foreground">
            <li>
              In Meta&apos;s app dashboard, take the <strong>phone number ID</strong>,{" "}
              <strong>access token</strong> and <strong>app secret</strong>.
            </li>
            <li>
              Invent a <strong>verify token</strong> — any long random string. You will paste
              the same value into Meta.
            </li>
            <li>Add them under Setup below.</li>
            <li>
              Point Meta&apos;s webhook at{" "}
              <code className="rounded bg-secondary px-1 py-0.5 font-mono text-[11px]">
                /api/v1/whatsapp/webhook
              </code>{" "}
              and subscribe to <code className="font-mono text-[11px]">messages</code>.
            </li>
          </ol>
          {canConfigure ? (
            <Button size="sm" onClick={() => setSetupOpen(true)}>
              <Plus className="size-3.5" aria-hidden="true" />
              Connect a number
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              Ask an administrator to connect it — this needs the{" "}
              <span className="font-mono">settings:write</span> permission.
            </p>
          )}
        </Card>
      )}

      {configured && (
        <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
          <ConversationList
            conversations={conversations}
            selectedId={selectedId}
            loading={loading}
            onSelect={setSelectedId}
          />
          <ConversationPane
            detail={detail}
            canReply={canReply}
            accessToken={accessToken}
            onSent={() => {
              setSelectedId((id) => id);
              void load();
            }}
            onError={setError}
          />
        </div>
      )}

      <SetupDialog
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        accounts={accounts}
        accessToken={accessToken}
        onChanged={() => void load()}
      />
    </div>
  );
}

// ── Conversation list ────────────────────────────────────────────────────────

function ConversationList({
  conversations,
  selectedId,
  loading,
  onSelect,
}: {
  conversations: Conversation[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <Card className="overflow-hidden lg:sticky lg:top-4 lg:self-start">
      <h2 className="border-b border-border bg-secondary/40 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Conversations
      </h2>
      {conversations.length === 0 ? (
        <p className="px-3 py-8 text-center text-xs text-muted-foreground">
          {loading ? "Loading…" : "Nobody has messaged this number yet."}
        </p>
      ) : (
        <ul className="max-h-128 divide-y divide-border overflow-y-auto">
          {conversations.map((c) => {
            const open =
              c.windowExpiresAt !== null && new Date(c.windowExpiresAt).getTime() > Date.now();
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  aria-current={c.id === selectedId ? "true" : undefined}
                  className={cn(
                    "flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    c.id === selectedId ? "bg-primary/10" : "hover:bg-accent",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {c.profileName || c.phoneNumber}
                    </span>
                    {/* Icon + text, never colour alone. */}
                    {open ? (
                      <Badge variant="success" className="shrink-0 gap-1">
                        <Clock className="size-2.5" aria-hidden="true" />
                        Open
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="shrink-0">
                        Closed
                      </Badge>
                    )}
                  </span>
                  <span className="truncate font-mono text-[11px] text-muted-foreground">
                    {c.phoneNumber}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ── Thread + reply ───────────────────────────────────────────────────────────

function ConversationPane({
  detail,
  canReply,
  accessToken,
  onSent,
  onError,
}: {
  detail: ConversationDetail | null;
  canReply: boolean;
  accessToken: string | undefined;
  onSent: () => void;
  onError: (message: string) => void;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [detail?.messages.length]);

  if (!detail) {
    return (
      <Card className="flex min-h-80 items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">Choose a conversation to read it.</p>
      </Card>
    );
  }

  async function send() {
    if (!accessToken || !detail || !body.trim()) return;
    setSending(true);
    try {
      await api.post(
        `/whatsapp/conversations/${detail.id}/messages`,
        { body: body.trim() },
        { accessToken },
      );
      setBody("");
      onSent();
    } catch (err: any) {
      onError(err?.message || "The reply could not be sent.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="flex min-h-80 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {detail.profileName || detail.phoneNumber}
          </p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {detail.phoneNumber}
          </p>
        </div>
        <Badge variant={detail.windowOpen ? "success" : "warning"}>
          {detail.windowOpen ? "Window open" : "Window closed"}
        </Badge>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {detail.messages.length === 0 && (
          <p className="py-8 text-center text-xs text-muted-foreground">No messages yet.</p>
        )}
        {detail.messages.map((m) => {
          const outbound = m.direction === "outbound";
          const failed = m.status === "failed";
          return (
            <div key={m.id} className={cn("flex", outbound ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[80%] rounded-xl px-3 py-2 text-sm",
                  outbound
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground",
                  failed && "border border-destructive/50 bg-destructive/10 text-destructive",
                )}
              >
                <p className="whitespace-pre-wrap wrap-break-word">{m.content}</p>
                <p
                  className={cn(
                    "mt-1 flex items-center gap-1 text-[10px]",
                    outbound && !failed ? "text-primary-foreground/70" : "text-muted-foreground",
                  )}
                >
                  {new Date(m.occurredAt).toLocaleString()}
                  {/* A failed send is kept, not hidden — otherwise an operator
                      retypes a reply believing it never left. */}
                  {failed && (
                    <>
                      <AlertCircle className="size-2.5" aria-hidden="true" />
                      Not delivered{m.errorMessage ? `: ${m.errorMessage}` : ""}
                    </>
                  )}
                  {outbound && m.status === "sent" && (
                    <CheckCircle2 className="size-2.5" aria-hidden="true" />
                  )}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="border-t border-border p-3">
        {!detail.windowOpen ? (
          /* Explains rather than just disabling — the rule is Meta's, and an
             inert box with no reason reads as a broken page. */
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-600 dark:text-amber-400">
            <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              More than 24 hours have passed since this customer&apos;s last message. WhatsApp
              only accepts an approved template message now, which this panel cannot send yet.
            </span>
          </p>
        ) : !canReply ? (
          <p className="text-xs text-muted-foreground">
            Replying needs the <span className="font-mono">whatsapp:reply</span> permission.
          </p>
        ) : (
          <div className="flex gap-2">
            <Input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Type a reply…"
              maxLength={4096}
              aria-label="Reply message"
              disabled={sending}
            />
            <Button onClick={() => void send()} disabled={sending || !body.trim()}>
              {sending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="size-4" aria-hidden="true" />
              )}
              Send
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Setup ────────────────────────────────────────────────────────────────────

function SetupDialog({
  open,
  onClose,
  accounts,
  accessToken,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  accounts: Account[];
  accessToken: string | undefined;
  onChanged: () => void;
}) {
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [displayPhoneNumber, setDisplayPhoneNumber] = useState("");
  const [tokenValue, setTokenValue] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!accessToken) return;
    setBusy(true);
    setFormError(null);
    try {
      await api.post(
        "/whatsapp/accounts",
        {
          phoneNumberId: phoneNumberId.trim(),
          ...(displayPhoneNumber.trim() ? { displayPhoneNumber: displayPhoneNumber.trim() } : {}),
          accessToken: tokenValue.trim(),
          verifyToken: verifyToken.trim(),
          appSecret: appSecret.trim(),
        },
        { accessToken },
      );
      setPhoneNumberId("");
      setDisplayPhoneNumber("");
      setTokenValue("");
      setVerifyToken("");
      setAppSecret("");
      onChanged();
    } catch (err: any) {
      setFormError(err?.message || "Could not save that number.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!accessToken) return;
    await api.delete(`/whatsapp/accounts/${id}`, { accessToken });
    onChanged();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>WhatsApp setup</DialogTitle>
          <DialogDescription>
            Credentials from Meta&apos;s Cloud API. They are stored server-side and never sent
            back to this browser.
          </DialogDescription>
        </DialogHeader>

        {accounts.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {accounts.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {a.displayPhoneNumber || a.phoneNumberId}
                  </p>
                  <p className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                    <span>Token {a.hasAccessToken ? "set" : "missing"}</span>
                    <span>· Secret {a.hasAppSecret ? "set" : "missing"}</span>
                    <span>· Verify {a.hasVerifyToken ? "set" : "missing"}</span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={a.isActive ? "success" : "secondary"}>
                    {a.isActive ? "Active" : "Off"}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void remove(a.id)}
                    aria-label={`Remove ${a.displayPhoneNumber || a.phoneNumberId}`}
                  >
                    <Trash2 className="size-3.5 text-destructive" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={create} className="space-y-3">
          <Field label="Phone number ID" value={phoneNumberId} onChange={setPhoneNumberId} required />
          <Field
            label="Display number"
            value={displayPhoneNumber}
            onChange={setDisplayPhoneNumber}
            hint="Optional, for your own reference — never used for routing."
          />
          <Field label="Access token" value={tokenValue} onChange={setTokenValue} required secret />
          <Field
            label="Verify token"
            value={verifyToken}
            onChange={setVerifyToken}
            required
            secret
            hint="Any long random string. Paste the same value into Meta."
          />
          <Field label="App secret" value={appSecret} onChange={setAppSecret} required secret />

          {formError && (
            <p role="alert" className="text-xs text-destructive">
              {formError}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Save number
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  secret,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  secret?: boolean;
  hint?: string;
}) {
  const id = `wa-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        type={secret ? "password" : "text"}
        autoComplete="off"
        className={secret ? "font-mono text-xs" : undefined}
      />
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
