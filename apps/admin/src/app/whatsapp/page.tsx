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
  Smartphone,
  Trash2,
  X,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { usePermission } from "@/lib/require-auth";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ConnectWizard, type WizardAccount } from "./connect-wizard";
import { ConnectChooser } from "./embedded-signup";
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
  /** `embedded`: connected with a Meta sign-in through DevsFleet's app. */
  connectionMethod?: "manual" | "embedded";
  /** Also live in the WhatsApp Business app on the owner's phone. */
  coexistence?: boolean;
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
  /** `phone_app`: sent from the WhatsApp Business app; `history`: imported past chat. */
  source?: "api" | "phone_app" | "history";
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
  const [wizard, setWizard] = useState<{ open: boolean; account: WizardAccount | null }>({ open: false, account: null });
  /** A new connection starts here: Meta sign-in when available, else the manual wizard. */
  const [chooserOpen, setChooserOpen] = useState(false);

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
            Connect your shop&apos;s WhatsApp Business number to answer customers here. The setup
            walks you through it and checks everything with Meta as you go — about 10 minutes.
          </p>
          {canConfigure ? (
            <Button size="sm" onClick={() => setChooserOpen(true)}>
              <Plus className="size-3.5" aria-hidden="true" />
              Connect WhatsApp
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
        onConnect={(account) => {
          setSetupOpen(false);
          if (account) setWizard({ open: true, account });
          else setChooserOpen(true);
        }}
      />

      <ConnectChooser
        open={chooserOpen}
        accessToken={accessToken}
        onClose={() => setChooserOpen(false)}
        onManual={() => {
          setChooserOpen(false);
          setWizard({ open: true, account: null });
        }}
        onConnected={() => void load()}
      />

      <ConnectWizard
        open={wizard.open}
        account={wizard.account}
        accessToken={accessToken}
        onClose={() => setWizard({ open: false, account: null })}
        onSaved={() => void load()}
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
                  {/* Who wrote it matters to whoever replies next: a colleague
                      on the phone app may already have answered. */}
                  {m.source === "phone_app" && (
                    <>
                      <Smartphone className="size-2.5" aria-hidden="true" />
                      Sent from phone
                    </>
                  )}
                  {m.source === "history" && <span>· Imported</span>}
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

type Health = "connected" | "token_expiring" | "token_invalid" | "webhook_not_subscribed" | "error";

const HEALTH: Record<Health, { label: string; variant: "success" | "destructive" | "secondary" | "default"; icon: typeof CheckCircle2 }> = {
  connected: { label: "Connected", variant: "success", icon: CheckCircle2 },
  token_expiring: { label: "Token expiring", variant: "destructive", icon: Clock },
  token_invalid: { label: "Token invalid", variant: "destructive", icon: AlertCircle },
  webhook_not_subscribed: { label: "Webhook not connected", variant: "secondary", icon: AlertCircle },
  error: { label: "Can't reach Meta", variant: "secondary", icon: AlertCircle },
};

/**
 * The connected numbers, each re-checked with Meta when this opens — a token
 * that expired last night shows as such here, rather than as a quiet inbox.
 */
function SetupDialog({
  open,
  onClose,
  accounts,
  accessToken,
  onChanged,
  onConnect,
}: {
  open: boolean;
  onClose: () => void;
  accounts: Account[];
  accessToken: string | undefined;
  onChanged: () => void;
  /** Opens the wizard: a new number when null, a token update otherwise. */
  onConnect: (account: WizardAccount | null) => void;
}) {
  const [health, setHealth] = useState<Record<string, { health: Health; message?: string } | "loading">>({});
  const [confirmRemove, setConfirmRemove] = useState<Account | null>(null);

  useEffect(() => {
    if (!open || !accessToken) return;
    let live = true;
    for (const a of accounts) {
      setHealth((h) => ({ ...h, [a.id]: "loading" }));
      api
        .get<{ health: Health; check: { problem?: { message: string }; warnings: string[] } }>(
          `/whatsapp/accounts/${a.id}/status`,
          { accessToken },
        )
        .then((r) => {
          if (live) setHealth((h) => ({ ...h, [a.id]: { health: r.health, message: r.check.problem?.message ?? r.check.warnings[0] } }));
        })
        .catch(() => {
          if (live) setHealth((h) => ({ ...h, [a.id]: { health: "error" } }));
        });
    }
    return () => {
      live = false;
    };
  }, [open, accessToken, accounts]);

  async function remove(id: string) {
    if (!accessToken) return;
    await api.delete(`/whatsapp/accounts/${id}`, { accessToken });
    setConfirmRemove(null);
    onChanged();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>WhatsApp numbers</DialogTitle>
          <DialogDescription>
            Each number is checked with Meta when you open this. Credentials are stored on the server and never
            sent back to this browser.
          </DialogDescription>
        </DialogHeader>

        {accounts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No number connected yet.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {accounts.map((a) => {
              const h = health[a.id];
              const meta = h && h !== "loading" ? HEALTH[h.health] : null;
              const Icon = meta?.icon;
              return (
                <li key={a.id} className="space-y-2 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{a.displayPhoneNumber || a.phoneNumberId}</p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">ID {a.phoneNumberId}</p>
                      {a.connectionMethod === "embedded" && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Connected with Meta sign-in
                          {a.coexistence ? " · also in the WhatsApp Business app" : ""}
                        </p>
                      )}
                    </div>
                    {h === "loading" || !h ? (
                      <Badge variant="secondary" className="shrink-0 gap-1">
                        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                        Checking
                      </Badge>
                    ) : (
                      <Badge variant={meta!.variant} className="shrink-0 gap-1">
                        {Icon && <Icon className="size-3" aria-hidden="true" />}
                        {meta!.label}
                      </Badge>
                    )}
                  </div>
                  {h && h !== "loading" && h.health !== "connected" && h.message && (
                    <p className="text-[11px] text-muted-foreground">{h.message}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {/* A Meta sign-in number has no token of the shop's to replace —
                        reconnecting goes through Meta again. */}
                    {a.connectionMethod !== "embedded" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          onConnect({
                            id: a.id,
                            phoneNumberId: a.phoneNumberId,
                            displayPhoneNumber: a.displayPhoneNumber,
                            businessAccountId: a.businessAccountId,
                          })
                        }
                      >
                        Update token
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setConfirmRemove(a)}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      Remove
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {confirmRemove && (
          <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs">
            <p className="text-destructive">
              Remove {confirmRemove.displayPhoneNumber || confirmRemove.phoneNumberId}? Messages to it will stop
              arriving here. Past conversations are kept.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setConfirmRemove(null)}>
                Keep
              </Button>
              <Button size="sm" variant="destructive" onClick={() => void remove(confirmRemove.id)}>
                Remove
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button type="button" onClick={() => onConnect(null)}>
            <Plus className="size-4" aria-hidden="true" />
            Connect a number
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
