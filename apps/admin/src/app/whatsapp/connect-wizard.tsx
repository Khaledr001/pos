"use client";

import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { api, getApiOrigin } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Connecting a WhatsApp number, one decision at a time.
 *
 * The old form asked for five values from three corners of Meta's console and
 * checked none of them; a wrong one surfaced days later as a webhook that
 * silently dropped every message. Here three values are pasted, Meta is asked
 * whether they work before anything is saved, and the webhook is wired by the
 * server rather than by hand where it can be.
 */

export interface WizardAccount {
  id: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  businessAccountId: string | null;
}

interface ConnectionCheck {
  ok: boolean;
  problem?: { step: "token" | "phone_number" | "business_account"; kind: string; message: string; fbtraceId?: string };
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  businessAccountId: string | null;
  qualityRating: string | null;
  codeVerificationStatus: string | null;
  tokenExpiresAt: string | null;
  tokenNeverExpires: boolean;
  missingPermissions: string[];
  webhookSubscribed: boolean | null;
  needsBusinessAccountId: boolean;
  warnings: string[];
}

interface ConnectResult {
  ok: boolean;
  steps: Array<{ key: string; ok: boolean; message: string; problem?: { fbtraceId?: string } }>;
  manual: { callbackUrl: string; verifyToken: string };
}

const WEBHOOK_PATH = "/api/v1/whatsapp/webhook";
const STEPS = ["Before you start", "Paste 3 values", "Check", "Connect"] as const;

export function ConnectWizard({
  open,
  onClose,
  accessToken,
  account,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  accessToken: string | undefined;
  /** Set to replace the token of a saved number; absent to connect a new one. */
  account?: WizardAccount | null;
  onSaved: () => void;
}) {
  const updating = Boolean(account);
  const [step, setStep] = useState(0);
  const [token, setToken] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [testing, setTesting] = useState(false);
  const [check, setCheck] = useState<ConnectionCheck | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [branchId, setBranchId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ id: string; verifyToken?: string } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectResult, setConnectResult] = useState<ConnectResult | null>(null);

  const callbackUrl = `${getApiOrigin()}${WEBHOOK_PATH}`;
  const callbackIsPublic = callbackUrl.startsWith("https://");

  // Every open starts clean: a half-finished attempt must not leak a token
  // into the next one, and an update starts at the paste step.
  useEffect(() => {
    if (!open) return;
    setStep(account ? 1 : 0);
    setToken("");
    setAppSecret("");
    setPhoneNumberId(account?.phoneNumberId ?? "");
    setWabaId(account?.businessAccountId ?? "");
    setCheck(null);
    setRequestError(null);
    setSaved(null);
    setConnectResult(null);
    setBranchId("");
  }, [open, account]);

  useEffect(() => {
    if (!open || !accessToken || updating) return;
    api
      .get<{ items?: Array<{ id: string; name: string }> }>("/branches", { accessToken, query: { limit: 200 } })
      .then((res) => setBranches(res.items ?? []))
      .catch(() => setBranches([]));
  }, [open, accessToken, updating]);

  async function runTest() {
    if (!accessToken) return;
    setTesting(true);
    setRequestError(null);
    setCheck(null);
    try {
      const body = updating
        ? {
            ...(token.trim() ? { accessToken: token.trim() } : {}),
            ...(appSecret.trim() ? { appSecret: appSecret.trim() } : {}),
            ...(wabaId.trim() ? { businessAccountId: wabaId.trim() } : {}),
          }
        : {
            accessToken: token.trim(),
            phoneNumberId: phoneNumberId.trim(),
            appSecret: appSecret.trim(),
            ...(wabaId.trim() ? { businessAccountId: wabaId.trim() } : {}),
          };
      const result = await api.post<ConnectionCheck>(
        updating ? `/whatsapp/accounts/${account!.id}/test` : "/whatsapp/accounts/test",
        body,
        { accessToken },
      );
      setCheck(result);
      setStep(2);
    } catch (err: any) {
      // A request the API refused outright — a phone number pasted where the
      // ID goes, say. Shown on the paste step, where it can be fixed.
      const details = err?.details as Record<string, string[] | undefined> | undefined;
      const first = details ? Object.values(details).flat().find(Boolean) : undefined;
      setRequestError(first || err?.message || "Couldn't run the check.");
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    if (!accessToken || !check?.ok) return;
    setSaving(true);
    setRequestError(null);
    try {
      if (updating) {
        await api.patch(
          `/whatsapp/accounts/${account!.id}`,
          {
            ...(token.trim() ? { accessToken: token.trim() } : {}),
            ...(appSecret.trim() ? { appSecret: appSecret.trim() } : {}),
            ...(check.businessAccountId ? { businessAccountId: check.businessAccountId } : {}),
            ...(check.displayPhoneNumber ? { displayPhoneNumber: check.displayPhoneNumber.slice(0, 20) } : {}),
          },
          { accessToken },
        );
        setSaved({ id: account!.id });
      } else {
        const created = await api.post<{ id: string; verifyToken?: string }>(
          "/whatsapp/accounts",
          {
            accessToken: token.trim(),
            phoneNumberId: phoneNumberId.trim(),
            appSecret: appSecret.trim(),
            ...(check.businessAccountId ? { businessAccountId: check.businessAccountId } : {}),
            ...(check.displayPhoneNumber ? { displayPhoneNumber: check.displayPhoneNumber.slice(0, 20) } : {}),
            ...(branchId ? { defaultBranchId: branchId } : {}),
          },
          { accessToken },
        );
        setSaved(created);
      }
      onSaved();
    } catch (err: any) {
      setRequestError(err?.message || "Couldn't save this number.");
    } finally {
      setSaving(false);
    }
  }

  async function connectWebhook() {
    if (!accessToken || !saved) return;
    setConnecting(true);
    setRequestError(null);
    try {
      setConnectResult(
        await api.post<ConnectResult>(`/whatsapp/accounts/${saved.id}/connect-webhook`, { callbackUrl }, { accessToken }),
      );
      onSaved();
    } catch (err: any) {
      setRequestError(err?.message || "Couldn't connect the webhook.");
    } finally {
      setConnecting(false);
    }
  }

  const canTest = updating
    ? Boolean(token.trim() || appSecret.trim() || wabaId.trim())
    : Boolean(token.trim() && phoneNumberId.trim() && appSecret.trim());
  const verifyTokenForManual = connectResult?.manual.verifyToken ?? saved?.verifyToken ?? null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>{updating ? "Update WhatsApp token" : "Connect WhatsApp"}</DialogTitle>
          <DialogDescription>
            {updating
              ? `Replace the token for ${account?.displayPhoneNumber || account?.phoneNumberId}. It's checked with Meta before it's saved.`
              : "About 10 minutes. Everything you paste is checked with Meta before it's saved."}
          </DialogDescription>
        </DialogHeader>

        <Stepper current={step} skipFirst={updating} />

        {step === 0 && (
          <div className="space-y-4">
            <p className="text-sm">You'll need these three things in Meta before you start:</p>
            <ul className="space-y-3">
              <ChecklistItem title="A Meta Business account" href="https://business.facebook.com/settings">
                Your company in Meta Business Suite. Most shops already have one from Facebook or Instagram.
              </ChecklistItem>
              <ChecklistItem title="A Meta app with WhatsApp added" href="https://developers.facebook.com/apps">
                In Meta for Developers, <strong>Create app</strong> → type <strong>Business</strong>, then add the{" "}
                <strong>WhatsApp</strong> product to it.
              </ChecklistItem>
              <ChecklistItem title="A phone number for the shop">
                Added under your app → <strong>WhatsApp → API Setup</strong>. It must{" "}
                <strong>not</strong> be in use on the WhatsApp phone app — delete the WhatsApp account on the phone
                first, or use a new number.
              </ChecklistItem>
            </ul>
            <p className="rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
              Next you'll paste three values from Meta. Each one has a "Where do I find this?" guide.
            </p>
          </div>
        )}

        {step === 1 && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canTest && !testing) void runTest();
            }}
          >
            {updating && (
              <p className="text-xs text-muted-foreground">
                Paste only what changed — anything left blank keeps its saved value.
              </p>
            )}
            <SecretField
              id="wa-token"
              label="Access token"
              value={token}
              onChange={setToken}
              required={!updating}
              help={
                <ol className="list-decimal space-y-1 pl-4">
                  <li>
                    Open{" "}
                    <ExtLink href="https://business.facebook.com/settings/system-users">Business Settings → System users</ExtLink>{" "}
                    and add a system user with the <strong>Admin</strong> role (or pick an existing one).
                  </li>
                  <li>
                    <strong>Assign assets</strong> → your app (Full control) and your WhatsApp account (Full control).
                  </li>
                  <li>
                    <strong>Generate new token</strong> → choose your app → expiry <strong>Never</strong> → tick{" "}
                    <code>whatsapp_business_messaging</code> and <code>whatsapp_business_management</code>.
                  </li>
                  <li>Copy the token. Meta shows it only once.</li>
                  <li className="text-amber-600 dark:text-amber-400">
                    Don't use the temporary token on the API Setup page — it stops working after 24 hours.
                  </li>
                </ol>
              }
            />
            {!updating && (
              <PlainField
                id="wa-phone-id"
                label="Phone number ID"
                value={phoneNumberId}
                onChange={setPhoneNumberId}
                inputMode="numeric"
                warn={/[+\s()-]/.test(phoneNumberId) ? "That looks like the phone number itself. Paste the Phone number ID — digits only." : null}
                help={
                  <ol className="list-decimal space-y-1 pl-4">
                    <li>
                      Open <ExtLink href="https://developers.facebook.com/apps">Meta for Developers</ExtLink> → your app.
                    </li>
                    <li>
                      Go to <strong>WhatsApp → API Setup</strong>.
                    </li>
                    <li>
                      Under <strong>From</strong>, pick your number. The <strong>Phone number ID</strong> is the long
                      number shown below it (e.g. 779418925277868) — not the phone number.
                    </li>
                  </ol>
                }
              />
            )}
            <SecretField
              id="wa-secret"
              label="App secret"
              value={appSecret}
              onChange={setAppSecret}
              required={!updating}
              help={
                <ol className="list-decimal space-y-1 pl-4">
                  <li>
                    In <ExtLink href="https://developers.facebook.com/apps">Meta for Developers</ExtLink>, open your app.
                  </li>
                  <li>
                    Go to <strong>App settings → Basic</strong>.
                  </li>
                  <li>
                    Next to <strong>App secret</strong>, click <strong>Show</strong>, confirm your password, and copy it.
                  </li>
                </ol>
              }
            />
            {(check?.needsBusinessAccountId || wabaId || check?.problem?.step === "business_account") && (
              <PlainField
                id="wa-waba"
                label="WhatsApp Business Account ID"
                value={wabaId}
                onChange={setWabaId}
                inputMode="numeric"
                help={
                  <p>
                    In your app → <strong>WhatsApp → API Setup</strong>, it's the <strong>WhatsApp Business Account ID</strong>{" "}
                    shown just above the phone number.
                  </p>
                }
              />
            )}
            {requestError && <ErrorBox message={requestError} />}
            <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
          </form>
        )}

        {step === 2 && check && <CheckResult check={check} />}

        {step === 3 && (
          <div className="space-y-4">
            {!saved ? (
              <>
                {!updating && (
                  <div>
                    <label htmlFor="wa-branch" className="mb-1 block text-xs font-medium">
                      Default branch
                    </label>
                    <SelectField
                      id="wa-branch"
                      size="sm"
                      value={branchId}
                      onValueChange={setBranchId}
                      options={[{ value: "", label: "No default" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Stock and prices for WhatsApp customers come from this branch.
                    </p>
                  </div>
                )}
                {requestError && <ErrorBox message={requestError} />}
              </>
            ) : (
              <div className="space-y-4">
                <p className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                  {updating ? "Token saved." : "Number saved."}
                </p>

                {updating && !callbackIsPublic ? (
                  <p className="text-xs text-muted-foreground">
                    Replacing a token doesn't change the webhook settings in Meta — nothing else to do.
                  </p>
                ) : callbackIsPublic ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Connect the webhook</p>
                    <p className="text-xs text-muted-foreground">
                      This tells Meta to send your customers' messages here, at{" "}
                      <code className="break-all">{callbackUrl}</code>.
                    </p>
                    {connectResult && (
                      <ul className="space-y-1.5">
                        {connectResult.steps.map((s) => (
                          <li key={s.key} className="flex items-start gap-2 text-xs">
                            {s.ok ? (
                              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                            ) : (
                              <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden="true" />
                            )}
                            <span>
                              <span className="sr-only">{s.ok ? "Done: " : "Failed: "}</span>
                              {s.message}
                              {s.problem?.fbtraceId && (
                                <span className="ml-1 text-muted-foreground">(Meta ref {s.problem.fbtraceId})</span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {requestError && <ErrorBox message={requestError} />}
                  </div>
                ) : null}

                {((!callbackIsPublic && !updating) || (connectResult && !connectResult.ok)) && (
                  <ManualWebhook callbackUrl={callbackUrl} verifyToken={verifyTokenForManual} isPublic={callbackIsPublic} />
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => (step === 0 || (updating && step === 1) || saved ? onClose() : setStep((s) => s - 1))}
          >
            {step === 0 || (updating && step === 1) || saved ? (saved ? "Done" : "Cancel") : "Back"}
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {step === 0 && <Button onClick={() => setStep(1)}>I have these — continue</Button>}
            {step === 1 && (
              <Button onClick={() => void runTest()} disabled={!canTest || testing}>
                {testing ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="size-4" aria-hidden="true" />}
                {testing ? "Checking with Meta…" : "Test connection"}
              </Button>
            )}
            {step === 2 && check && !check.ok && (
              <Button onClick={() => setStep(1)}>Fix and test again</Button>
            )}
            {step === 2 && check?.ok && <Button onClick={() => setStep(3)}>Continue</Button>}
            {step === 3 && !saved && (
              <Button onClick={() => void save()} disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
                {updating ? "Save new token" : "Save number"}
              </Button>
            )}
            {step === 3 && saved && callbackIsPublic && !connectResult?.ok && (
              <Button onClick={() => void connectWebhook()} disabled={connecting}>
                {connecting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                {connectResult ? "Try again" : "Connect webhook automatically"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Stepper({ current, skipFirst }: { current: number; skipFirst: boolean }) {
  const steps = STEPS.map((label, i) => ({ label, i })).filter((s) => !(skipFirst && s.i === 0));
  return (
    <ol className="flex items-center gap-1.5 text-[11px]" aria-label="Progress">
      {steps.map(({ label, i }, n) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-1.5" aria-current={active ? "step" : undefined}>
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold",
                done && "border-primary bg-primary text-primary-foreground",
                active && "border-primary text-primary",
                !done && !active && "border-border text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3" aria-hidden="true" /> : n + 1}
            </span>
            <span className={cn("hidden truncate sm:inline", active ? "font-semibold" : "text-muted-foreground")}>
              {label}
            </span>
            {n < steps.length - 1 && <span aria-hidden="true" className="h-px flex-1 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}

function ChecklistItem({ title, href, children }: { title: string; href?: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 rounded-lg border border-border p-3">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 text-sm">
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{children}</p>
        {href && (
          <ExtLink href={href} className="mt-1 inline-flex text-xs">
            Open in Meta
          </ExtLink>
        )}
      </div>
    </li>
  );
}

function ExtLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("inline-flex items-center gap-0.5 font-medium text-primary underline-offset-2 hover:underline", className)}
    >
      {children}
      <ExternalLink className="size-3" aria-hidden="true" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function Help({ children }: { children: React.ReactNode }) {
  return (
    <details className="group mt-1.5 rounded-lg border border-border bg-secondary/30 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-1 px-2.5 py-1.5 font-medium text-primary [&::-webkit-details-marker]:hidden">
        <ChevronDown className="size-3 transition-transform group-open:rotate-180" aria-hidden="true" />
        Where do I find this?
      </summary>
      <div className="px-2.5 pb-2.5 text-muted-foreground">{children}</div>
    </details>
  );
}

function SecretField({
  id,
  label,
  value,
  onChange,
  required,
  help,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  help: React.ReactNode;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      <div className="relative">
        <Input
          id={id}
          type={shown ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="pr-10 font-mono text-xs"
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={shown}
          className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          {shown ? <EyeOff className="size-3.5" aria-hidden="true" /> : <Eye className="size-3.5" aria-hidden="true" />}
        </button>
      </div>
      <Help>{help}</Help>
    </div>
  );
}

function PlainField({
  id,
  label,
  value,
  onChange,
  inputMode,
  warn,
  help,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  warn?: string | null;
  help: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium">
        {label}
      </label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} inputMode={inputMode} autoComplete="off" className="font-mono text-xs" />
      {warn && (
        <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-600 dark:text-amber-400">
          <AlertCircle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          {warn}
        </p>
      )}
      <Help>{help}</Help>
    </div>
  );
}

function ErrorBox({ message, reference }: { message: string; reference?: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div>
        <p>{message}</p>
        {reference && <p className="mt-1 opacity-80">Meta reference: {reference}</p>}
      </div>
    </div>
  );
}

const STEP_NAMES = { token: "access token", phone_number: "phone number ID", business_account: "business account" } as const;

function CheckResult({ check }: { check: ConnectionCheck }) {
  if (!check.ok && check.problem) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium">The {STEP_NAMES[check.problem.step]} didn't pass.</p>
        <ErrorBox message={check.problem.message} reference={check.problem.fbtraceId} />
      </div>
    );
  }
  const expiresSoon = Boolean(check.tokenExpiresAt);
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">Meta recognises this number</p>
          <p className="text-lg font-bold tabular-nums">{check.displayPhoneNumber ?? "—"}</p>
          {check.verifiedName && <p className="text-xs text-muted-foreground">Shows to customers as “{check.verifiedName}”</p>}
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
        <Fact label="Token">
          {check.tokenNeverExpires ? (
            <span className="text-emerald-700 dark:text-emerald-400">Permanent ✓</span>
          ) : check.tokenExpiresAt ? (
            <span className="font-semibold text-destructive">Expires {new Date(check.tokenExpiresAt).toLocaleString()}</span>
          ) : (
            "Expiry unknown"
          )}
        </Fact>
        <Fact label="Quality rating">{check.qualityRating ? titleCase(check.qualityRating) : "—"}</Fact>
        <Fact label="Business account">{check.businessAccountId ?? "Not found"}</Fact>
        <Fact label="Webhook">
          {check.webhookSubscribed === true ? "Connected ✓" : check.webhookSubscribed === false ? "Not connected yet" : "Checked after saving"}
        </Fact>
      </dl>

      {expiresSoon && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border-2 border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            <strong>This token will stop working.</strong> Temporary tokens last 24 hours, after which customers' messages
            can't be answered. Go back and paste a permanent System User token (expiry: Never).
          </p>
        </div>
      )}

      {check.missingPermissions.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Missing permission: {check.missingPermissions.join(", ")}.
        </p>
      )}

      {check.warnings.filter((w) => !/expires on/.test(w)).map((w) => (
        <p key={w} className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {w}
        </p>
      ))}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/60 pb-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function ManualWebhook({ callbackUrl, verifyToken, isPublic }: { callbackUrl: string; verifyToken: string | null; isPublic: boolean }) {
  return (
    <div className="min-w-0 space-y-3 rounded-lg border border-border p-3">
      <p className="text-sm font-medium">Connect the webhook in Meta</p>
      {!isPublic && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          This server isn't on a public HTTPS address yet, so Meta can't reach it automatically. Once it's online, set it
          in Meta like this:
        </p>
      )}
      <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
        <li>
          In <ExtLink href="https://developers.facebook.com/apps">Meta for Developers</ExtLink> → your app →{" "}
          <strong>WhatsApp → Configuration</strong>, click <strong>Edit</strong> under Webhook.
        </li>
        <li>Paste the Callback URL and Verify token below, then <strong>Verify and save</strong>.</li>
        <li>
          Under <strong>Webhook fields</strong>, <strong>Subscribe</strong> to <code>messages</code>.
        </li>
      </ol>
      <CopyRow label="Callback URL" value={callbackUrl} />
      {verifyToken ? (
        <CopyRow label="Verify token" value={verifyToken} secret />
      ) : (
        <p className="text-[11px] text-muted-foreground">The verify token was shown when this number was first saved.</p>
      )}
    </div>
  );
}

function CopyRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium text-muted-foreground">{label}</p>
      <div className="flex min-w-0 items-center gap-2">
        {/* Wrapped, not truncated: the whole value has to be checkable by eye before it is pasted into Meta. */}
        <code className={cn("min-w-0 flex-1 break-all rounded-md border border-border bg-secondary/40 px-2 py-1.5 text-[11px]", secret && "font-mono")}>
          {value}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          aria-label={`Copy ${label.toLowerCase()}`}
        >
          {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

function titleCase(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase();
}
