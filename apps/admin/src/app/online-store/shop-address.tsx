"use client";

import React, { useEffect, useState } from "react";
import { CheckCircle2, Globe, Loader2, Sparkles, XCircle } from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export interface PlatformDomain {
  /** "devsfleet.com" when free `<name>.devsfleet.com` addresses are offered; null otherwise. */
  baseDomain: string | null;
  suggestedLabel: string | null;
}

interface Availability {
  label: string;
  hostname: string | null;
  available: boolean;
  reason?: string;
}

/** The address the form will save, or null while it isn't one the server would accept. */
export type ShopAddress = { domain: string } | null;

/**
 * Where shoppers will find the store: a free address on the platform's domain,
 * checked live as the owner types, or the business's own domain.
 *
 * The check is a courtesy — the server applies the same rules on save — but it
 * means "pos" or a taken name is explained before the button is pressed rather
 * than as an error afterwards.
 */
export function ShopAddressPicker({
  platform,
  accessToken,
  onChange,
  idPrefix = "shop-address",
}: {
  platform: PlatformDomain | undefined;
  accessToken: string | undefined;
  onChange: (address: ShopAddress) => void;
  idPrefix?: string;
}) {
  const base = platform?.baseDomain ?? null;
  const [mode, setMode] = useState<"free" | "own">(base ? "free" : "own");
  const [label, setLabel] = useState(platform?.suggestedLabel ?? "");
  const [own, setOwn] = useState("");
  const [check, setCheck] = useState<{ state: "idle" | "checking" | "done" | "error"; result?: Availability }>({
    state: "idle",
  });

  // Debounced: one request per pause in typing, and the reply to a stale
  // label is dropped so it can't overwrite the answer for the current one.
  useEffect(() => {
    if (mode !== "free" || !base) return;
    const wanted = label.trim().toLowerCase();
    if (!wanted) {
      setCheck({ state: "idle" });
      return;
    }
    let live = true;
    setCheck({ state: "checking" });
    const timer = setTimeout(() => {
      api
        .get<Availability>("/storefront-admin/settings/subdomain-availability", { accessToken, query: { label: wanted } })
        .then((result) => live && setCheck({ state: "done", result }))
        .catch(() => live && setCheck({ state: "error" }));
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [label, mode, base, accessToken]);

  useEffect(() => {
    if (mode === "free") {
      const r = check.result;
      onChange(check.state === "done" && r?.available && r.hostname ? { domain: r.hostname } : null);
    } else {
      const host = own.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/:].*$/, "");
      onChange(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? { domain: host } : null);
    }
    // onChange is the parent's setter; re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, check, own]);

  return (
    <div className="space-y-3">
      {base && (
        <div role="radiogroup" aria-label="Shop address type" className="grid gap-2 sm:grid-cols-2">
          {(
            [
              { value: "free", title: "Free shop address", body: `yourshop.${base} — ready straight away`, icon: Sparkles },
              { value: "own", title: "Use your own domain", body: "e.g. shop.yourbusiness.ae — you point its DNS here", icon: Globe },
            ] as const
          ).map(({ value, title, body, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => setMode(value)}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                mode === value ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/50",
              )}
            >
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", mode === value ? "text-primary" : "text-muted-foreground")} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{title}</span>
                <span className="block text-xs text-muted-foreground">{body}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {mode === "free" && base ? (
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-label`} className="block text-xs font-medium">
            Shop address
          </label>
          <div className="flex h-10 min-w-0 items-stretch overflow-hidden rounded-lg border border-input focus-within:ring-2 focus-within:ring-ring">
            <span className="flex items-center pl-3 text-sm text-muted-foreground">https://</span>
            <input
              id={`${idPrefix}-label`}
              value={label}
              onChange={(e) => setLabel(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              maxLength={40}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={`${idPrefix}-status`}
              className="min-w-0 flex-1 bg-transparent px-1 text-sm font-medium outline-none"
              placeholder="yourshop"
            />
            <span className="flex shrink-0 items-center border-l border-input bg-secondary/40 px-3 text-sm text-muted-foreground">
              .{base}
            </span>
          </div>
          <p id={`${idPrefix}-status`} aria-live="polite" className="flex min-h-5 items-center gap-1.5 text-xs">
            {check.state === "checking" && (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">Checking…</span>
              </>
            )}
            {check.state === "done" && check.result?.available && (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                <span className="text-emerald-700 dark:text-emerald-400">{check.result.hostname} is available.</span>
              </>
            )}
            {check.state === "done" && check.result && !check.result.available && (
              <>
                <XCircle className="h-3.5 w-3.5 text-destructive" />
                <span className="text-destructive">{check.result.reason}</span>
              </>
            )}
            {check.state === "error" && <span className="text-destructive">Couldn&apos;t check that address. Try again.</span>}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-own`} className="block text-xs font-medium">
            Your domain
          </label>
          <Input id={`${idPrefix}-own`} value={own} onChange={(e) => setOwn(e.target.value)} placeholder="shop.yourbusiness.ae" className="h-10" />
          <p className="text-xs text-muted-foreground">
            The hostname shoppers will type. Point its DNS at the platform before shoppers use it.
          </p>
        </div>
      )}
    </div>
  );
}
