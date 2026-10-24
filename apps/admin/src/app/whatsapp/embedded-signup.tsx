"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  PhoneCall,
  Smartphone,
  Wrench,
  XCircle,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * "Connect with Meta" — Embedded Signup, including coexistence.
 *
 * The shop logs into Meta in Meta's own popup and picks its number; nothing
 * is pasted. The popup ends with a one-time `code` (via FB.login's callback)
 * and the ids it chose (via a postMessage from facebook.com). Both go to the
 * API, which checks the ids against what Meta actually granted before
 * anything is saved — the ids are only a claim until then.
 *
 * META-SPECIFIC NAMES are mirrored from apps/api/src/modules/whatsapp/meta-embedded.ts.
 * Change them in both places.
 */
const SDK_URL = "https://connect.facebook.net/en_US/sdk.js";
const COEXISTENCE_FEATURE_TYPE = "whatsapp_business_app_onboarding";
const SESSION_INFO_VERSION = "3";
const SESSION_EVENT_TYPE = "WA_EMBEDDED_SIGNUP";
/** Only Meta's own pages may report a signup. */
const META_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*facebook\.com$/;

type Path = "coexistence" | "new";

type EmbeddedConfig =
  | { enabled: true; appId: string; configId: string; graphVersion: string }
  | { enabled: false; missing: string[]; invalid?: string };

interface SignupResult {
  ok: boolean;
  accountId?: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  coexistence: boolean;
  historySyncRequested: boolean;
  steps: Array<{ key: string; ok: boolean; message: string; fbtraceId?: string }>;
  problem?: { step: string; message: string; fbtraceId?: string };
}

interface FacebookSdk {
  init(options: { appId: string; autoLogAppEvents?: boolean; xfbml?: boolean; version: string }): void;
  login(
    callback: (response: { authResponse?: { code?: string } | null; status?: string }) => void,
    options: Record<string, unknown>,
  ): void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

/** Loaded on demand — only when someone clicks Connect — and once per page. */
let sdkPromise: Promise<FacebookSdk> | null = null;
function loadSdk(appId: string, version: string): Promise<FacebookSdk> {
  if (window.FB) return Promise.resolve(window.FB);
  sdkPromise ??= new Promise<FacebookSdk>((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      resolve(window.FB!);
    };
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error("Couldn't load Meta's sign-in. Check your connection, or turn off a blocker for facebook.com."));
    };
    document.body.appendChild(script);
  });
  return sdkPromise;
}

/** The session-info postMessage, or null for anything else (including other origins). */
export function readSessionEvent(event: { origin: string; data: unknown }):
  | { kind: "finish"; wabaId: string; phoneNumberId: string }
  | { kind: "cancel"; step: string | null }
  | { kind: "error"; message: string }
  | { kind: "incomplete" }
  | null {
  if (!META_ORIGIN.test(event.origin)) return null;
  let data: unknown = event.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  const d = data as { type?: string; event?: string; data?: Record<string, string | undefined> } | null;
  if (!d || d.type !== SESSION_EVENT_TYPE) return null;
  const payload = d.data ?? {};
  if (d.event === "CANCEL") return { kind: "cancel", step: payload.current_step ?? null };
  if (d.event === "ERROR") return { kind: "error", message: payload.error_message ?? "Meta reported an error." };
  if (d.event?.startsWith("FINISH")) {
    return payload.waba_id && payload.phone_number_id
      ? { kind: "finish", wabaId: payload.waba_id, phoneNumberId: payload.phone_number_id }
      : { kind: "incomplete" };
  }
  return null;
}

export function ConnectChooser({
  open,
  onClose,
  accessToken,
  onManual,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  accessToken: string | undefined;
  /** Open the paste-three-values wizard instead. */
  onManual: () => void;
  onConnected: () => void;
}) {
  const [config, setConfig] = useState<EmbeddedConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [path, setPath] = useState<Path | null>(null);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [branchId, setBranchId] = useState("");
  const [phase, setPhase] = useState<"choose" | "meta" | "finishing" | "done">("choose");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SignupResult | null>(null);

  // The popup reports through two channels that arrive in either order.
  const codeRef = useRef<string | null>(null);
  const sessionRef = useRef<{ wabaId: string; phoneNumberId: string } | null>(null);
  const finishingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setPath(null);
    setPhase("choose");
    setError(null);
    setResult(null);
    setBranchId("");
    codeRef.current = null;
    sessionRef.current = null;
    finishingRef.current = false;
    if (!accessToken) return;
    setConfig(null);
    setConfigError(null);
    api
      .get<EmbeddedConfig>("/whatsapp/embedded-signup/config", { accessToken })
      .then(setConfig)
      .catch((err: any) => setConfigError(err?.message || "Couldn't check how WhatsApp can be connected."));
    api
      .get<{ items?: Array<{ id: string; name: string }> }>("/branches", { accessToken, query: { limit: 200 } })
      .then((res) => setBranches(res.items ?? []))
      .catch(() => setBranches([]));
  }, [open, accessToken]);

  const finish = useCallback(async () => {
    const code = codeRef.current;
    const session = sessionRef.current;
    if (!code || !session || finishingRef.current || !accessToken || !path) return;
    finishingRef.current = true;
    setPhase("finishing");
    setError(null);
    try {
      const outcome = await api.post<SignupResult>(
        "/whatsapp/embedded-signup/complete",
        {
          code,
          wabaId: session.wabaId,
          phoneNumberId: session.phoneNumberId,
          coexistence: path === "coexistence",
          ...(branchId ? { defaultBranchId: branchId } : {}),
        },
        { accessToken },
      );
      setResult(outcome);
      setPhase("done");
      if (outcome.ok) onConnected();
    } catch (err: any) {
      setError(err?.message || "Couldn't finish connecting the number.");
      setPhase("choose");
    } finally {
      finishingRef.current = false;
    }
  }, [accessToken, path, branchId, onConnected]);

  // The session-info channel: facebook.com tells the opener which number was picked.
  useEffect(() => {
    if (!open) return;
    function onMessage(event: MessageEvent) {
      const info = readSessionEvent(event);
      if (!info) return;
      if (info.kind === "finish") {
        sessionRef.current = { wabaId: info.wabaId, phoneNumberId: info.phoneNumberId };
        void finish();
      } else if (info.kind === "cancel") {
        setPhase("choose");
        setError(
          info.step
            ? `Meta's window was closed before the end (at "${info.step.toLowerCase().replace(/_/g, " ")}"). Nothing was connected — start again when ready.`
            : "Meta's window was closed before the end. Nothing was connected.",
        );
      } else if (info.kind === "error") {
        setPhase("choose");
        setError(`Meta reported a problem: ${info.message}`);
      } else {
        setPhase("choose");
        setError("Meta finished without a phone number. Start again and add or pick the shop's number.");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [open, finish]);

  async function connect() {
    if (!config?.enabled || !path) return;
    setError(null);
    setPhase("meta");
    codeRef.current = null;
    sessionRef.current = null;
    try {
      const FB = await loadSdk(config.appId, config.graphVersion);
      FB.login(
        (response) => {
          const code = response.authResponse?.code;
          if (!code) {
            // Closed or declined. A CANCEL session event may already have said where.
            setPhase((p) => (p === "meta" ? "choose" : p));
            setError((e) => e ?? "Meta's sign-in was closed before it finished. Nothing was connected.");
            return;
          }
          codeRef.current = code;
          void finish();
          // The code arrived but the number never did — don't wait forever.
          window.setTimeout(() => {
            if (!sessionRef.current && codeRef.current === code) {
              setPhase("choose");
              setError("Meta signed you in but didn't say which number was chosen. Start again.");
            }
          }, 15_000);
        },
        {
          config_id: config.configId,
          response_type: "code",
          override_default_response_type: true,
          extras: {
            setup: {},
            sessionInfoVersion: SESSION_INFO_VERSION,
            ...(path === "coexistence" ? { featureType: COEXISTENCE_FEATURE_TYPE } : {}),
          },
        },
      );
    } catch (err: any) {
      setPhase("choose");
      setError(err?.message || "Couldn't open Meta's sign-in.");
    }
  }

  const busy = phase === "meta" || phase === "finishing";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>Connect WhatsApp</DialogTitle>
          <DialogDescription>
            {phase === "done" && result?.ok
              ? "Your number is connected."
              : "Sign in with Meta and pick your number — there's nothing to copy or paste."}
          </DialogDescription>
        </DialogHeader>

        {!config && !configError && (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Checking…
          </p>
        )}

        {configError && <Notice tone="error">{configError}</Notice>}

        {config && !config.enabled && (
          <div className="space-y-3">
            <Notice tone="info">
              Connecting with a Meta sign-in isn't switched on for this system yet. DevsFleet has to finish
              Meta's approval for its app (Business Verification and app review) and add four settings on the
              server. Until then you can connect a number with the manual setup — about 10 minutes.
            </Notice>
            <p className="text-xs text-muted-foreground">
              Keeping your number in the WhatsApp Business app on your phone needs the Meta sign-in; the manual
              setup moves the number off the phone app.
            </p>
            <div className="flex justify-end">
              <Button onClick={onManual}>
                <Wrench className="size-4" aria-hidden="true" /> Set up manually
              </Button>
            </div>
          </div>
        )}

        {config?.enabled && phase !== "done" && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Which number">
              <PathCard
                selected={path === "coexistence"}
                disabled={busy}
                onSelect={() => setPath("coexistence")}
                icon={Smartphone}
                title="Use my existing WhatsApp Business app number"
                note="Recommended if customers already message you"
              >
                Keep using the WhatsApp Business app on your phone. Messages from both appear here, and your
                recent chats are imported.
              </PathCard>
              <PathCard
                selected={path === "new"}
                disabled={busy}
                onSelect={() => setPath("new")}
                icon={PhoneCall}
                title="Connect a new number"
              >
                A number that isn't on WhatsApp yet. You'll verify it with a code from Meta during sign-in.
              </PathCard>
            </div>

            {path === "coexistence" && (
              <ul className="space-y-1 rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
                <li>• Have your phone ready — Meta asks you to scan a QR code with the WhatsApp Business app.</li>
                <li>• Keep the app installed and open it at least every couple of weeks, or the link can lapse.</li>
                <li>• Meta turns off a few app features for linked numbers (for example some broadcast and disappearing-message options).</li>
              </ul>
            )}

            {path && branches.length > 0 && (
              <div>
                <label htmlFor="es-branch" className="mb-1 block text-xs font-medium">
                  Default branch for these conversations
                </label>
                <SelectField
                  id="es-branch"
                  size="sm"
                  value={branchId}
                  onValueChange={setBranchId}
                  options={[{ value: "", label: "None" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
                  disabled={busy}
                />
              </div>
            )}

            {error && <Notice tone="error">{error}</Notice>}

            {busy && <Progress phase={phase} coexistence={path === "coexistence"} />}

            <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={onManual}
                disabled={busy}
                className="cursor-pointer self-start text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                Set up manually instead
              </button>
              <Button onClick={() => void connect()} disabled={!path || busy}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="size-4" aria-hidden="true" />}
                Continue with Meta
              </Button>
            </div>
          </div>
        )}

        {phase === "done" && result && <ResultView result={result} onClose={onClose} onRetry={() => setPhase("choose")} />}
      </DialogContent>
    </Dialog>
  );
}

function PathCard({
  selected,
  disabled,
  onSelect,
  icon: Icon,
  title,
  note,
  children,
}: {
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  icon: typeof Smartphone;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex cursor-pointer flex-col gap-2 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
        selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-secondary/40",
      )}
    >
      <span className={cn("flex size-9 items-center justify-center rounded-lg", selected ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground")}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="text-sm font-semibold">{title}</span>
      {note && <span className="text-[11px] font-medium text-primary">{note}</span>}
      <span className="text-xs text-muted-foreground">{children}</span>
    </button>
  );
}

function Progress({ phase, coexistence }: { phase: "meta" | "finishing" | "choose" | "done"; coexistence: boolean }) {
  const steps =
    phase === "meta"
      ? ["Waiting for you to finish in Meta's window…"]
      : ["Exchanging the sign-in with Meta…", "Subscribing the number to this system…", coexistence ? "Requesting your chat history…" : "Registering the number…"];
  return (
    <ul className="space-y-1.5 rounded-lg border border-border p-3 text-sm" aria-live="polite">
      {steps.map((s) => (
        <li key={s} className="flex items-center gap-2">
          <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden="true" />
          {s}
        </li>
      ))}
    </ul>
  );
}

function ResultView({ result, onClose, onRetry }: { result: SignupResult; onClose: () => void; onRetry: () => void }) {
  return (
    <div className="space-y-4">
      {result.ok ? (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden="true" />
          <div className="min-w-0 space-y-1 text-sm">
            <p className="font-semibold">
              {result.displayPhoneNumber ?? "Your number"}
              {result.verifiedName ? ` · ${result.verifiedName}` : ""} is connected.
            </p>
            {result.coexistence ? (
              <p className="text-muted-foreground">
                Keep using the WhatsApp Business app on your phone; messages from both appear here.
                {result.historySyncRequested ? " Your recent chats are being imported — they'll appear over the next few minutes." : ""}
              </p>
            ) : (
              <p className="text-muted-foreground">Customers who message this number will appear in the inbox.</p>
            )}
          </div>
        </div>
      ) : (
        <Notice tone="error" reference={result.problem?.fbtraceId}>
          {result.problem?.message ?? "The number couldn't be connected."}
        </Notice>
      )}

      <ul className="space-y-1.5 text-xs">
        {result.steps.map((s) => (
          <li key={s.key} className="flex items-start gap-2">
            {s.ok ? (
              <CheckCircle2 className="mt-px size-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
            ) : (
              <XCircle className="mt-px size-3.5 shrink-0 text-destructive" aria-hidden="true" />
            )}
            <span className={s.ok ? "text-muted-foreground" : "text-foreground"}>
              {s.message}
              {s.fbtraceId && <span className="ml-1 font-mono text-[10px] text-muted-foreground">(ref {s.fbtraceId})</span>}
            </span>
          </li>
        ))}
      </ul>

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        {!result.ok && (
          <Button variant="outline" onClick={onRetry}>
            Start again
          </Button>
        )}
        <Button onClick={onClose}>{result.ok ? "Done" : "Close"}</Button>
      </div>
    </div>
  );
}

function Notice({ tone, reference, children }: { tone: "error" | "info"; reference?: string; children: React.ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-lg border p-3 text-sm",
        tone === "error"
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-border bg-secondary/40 text-foreground",
      )}
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {children}
        {reference && <p className="mt-1 font-mono text-[10px] opacity-80">Meta reference: {reference}</p>}
      </div>
    </div>
  );
}
