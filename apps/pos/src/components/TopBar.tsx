import type { SyncStatusSnapshot } from "@devsfleet/shared-types";
import {
  CloudOff,
  Lock,
  RefreshCw,
  Store,
  User,
  Wallet,
  Zap,
} from "lucide-react";
import React, { useEffect, useState } from "react";
import { Money } from "@devsfleet/shared-utils";
import { amount } from "../lib/money.js";
import { hasBridge } from "../lib/pos-data.js";
import { useAuth } from "../store/auth.js";

/**
 * POS Status Strip (TopBar).
 *
 * Answers at a glance:
 * - Active branch and till terminal
 * - Signed-in cashier & assigned role
 * - Real-time cash drawer float status
 * - Sync telemetry, network connectivity & queued outbox items
 * - Live counter clock
 */
export function TopBar({
  cashSessionFloat,
  onSyncNow,
}: {
  cashSessionFloat: string | null;
  onSyncNow?: () => void;
}) {
  const { cashier, terminal } = useAuth();
  const [sync, setSync] = useState<SyncStatusSnapshot | null>(null);
  const [browserApiOnline, setBrowserApiOnline] = useState<boolean>(true);
  const [clock, setClock] = useState(() => new Date());
  const [manualSyncing, setManualSyncing] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const checkApiHealth = async () => {
    try {
      const rawUrl =
        (import.meta.env.VITE_API_URL as string | undefined) ||
        "http://localhost:3001/api/v1";
      const parsed = new URL(rawUrl);
      
      // Probe root /health first
      let ok = false;
      try {
        const res = await fetch(`${parsed.origin}/health`, {
          signal: AbortSignal.timeout(2500),
        });
        ok = res.ok;
      } catch {}

      // Fallback to prefixed /health if root failed
      if (!ok) {
        try {
          const res = await fetch(`${rawUrl.replace(/\/+$/, "")}/health`, {
            signal: AbortSignal.timeout(2500),
          });
          ok = res.ok;
        } catch {}
      }

      setBrowserApiOnline(ok);
      return ok;
    } catch {
      setBrowserApiOnline(false);
      return false;
    }
  };

  useEffect(() => {
    if (hasBridge()) {
      let live = true;
      void window.devsfleet.sync.status().then((s) => live && setSync(s));
      return window.devsfleet.sync.onStatusChange(setSync);
    } else {
      // Browser mode: poll API health
      void checkApiHealth();
      const healthTimer = setInterval(() => void checkApiHealth(), 8_000);
      return () => clearInterval(healthTimer);
    }
  }, []);

  async function handleSyncClick() {
    setManualSyncing(true);
    try {
      if (hasBridge()) {
        await window.devsfleet.sync.now();
      } else {
        await checkApiHealth();
        onSyncNow?.();
      }
    } finally {
      setTimeout(() => setManualSyncing(false), 800);
    }
  }

  const isElectron = hasBridge();
  const isOnline = isElectron ? (sync?.online ?? false) : browserApiOnline;
  const isSyncing = (sync?.syncing ?? false) || manualSyncing;
  const pending = sync?.pendingPushCount ?? 0;

  return (
    <header className="flex h-13 shrink-0 items-center justify-between gap-4 border-b border-(--pos-border) bg-(--pos-panel) px-3 md:px-4 select-none">
      {/* ── Left: Terminal & Cashier Identity ── */}
      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
        {/* Branch & Till */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="size-7 rounded-lg bg-(--pos-raised) text-(--pos-accent) flex items-center justify-center shrink-0 border border-(--pos-border)">
            <Store className="size-3.5" />
          </div>
          <div className="leading-tight min-w-0">
            <div className="text-xs font-bold text-(--pos-text) truncate">
              {terminal?.branchName ?? "Counter Till"}
            </div>
            <div className="num font-mono text-[10px] text-(--pos-text-3) truncate">
              {terminal?.deviceName ?? "Till #1"}
            </div>
          </div>
        </div>

        <div className="h-5 w-px bg-(--pos-border) hidden sm:block" />

        {/* Active Cashier */}
        <div className="hidden sm:flex items-center gap-2 text-xs">
          <div className="size-6 rounded-full bg-(--pos-raised) flex items-center justify-center text-(--pos-text-3) border border-(--pos-border)">
            <User className="size-3" />
          </div>
          <span
            className={
              cashier
                ? "font-semibold text-(--pos-text) truncate max-w-30"
                : "text-(--pos-text-3)"
            }
          >
            {cashier?.name ?? "Not signed in"}
          </span>
          {cashier && (
            <span className="rounded-md bg-(--pos-raised) px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider text-(--pos-text-2) border border-(--pos-border)">
              {cashier.roleName}
            </span>
          )}
        </div>
      </div>

      {/* ── Right: Drawer Status, Sync Health & Clock ── */}
      <div className="flex items-center gap-2 sm:gap-3.5 shrink-0">
        {/* Drawer State Capsule */}
        <div
          className={[
            "flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-colors",
            cashSessionFloat
              ? "bg-signal-green/10 border-signal-green/30 text-signal-green"
              : "bg-(--pos-raised) border-(--pos-border) text-(--pos-text-3)",
          ].join(" ")}
          title={
            cashSessionFloat
              ? `Cash drawer open with ${amount(Money.toMinor(cashSessionFloat))} float`
              : "Cash drawer is currently closed"
          }
        >
          {cashSessionFloat ? (
            <>
              <Wallet className="size-3.5 shrink-0" />
              <span className="font-mono font-bold text-xs">
                {amount(Money.toMinor(cashSessionFloat))}
              </span>
            </>
          ) : (
            <>
              <Lock className="size-3.5 shrink-0" />
              <span className="text-[11px] font-medium">Drawer closed</span>
            </>
          )}
        </div>

        <div className="h-5 w-px bg-(--pos-border) hidden sm:block" />

        {/* Sync & Connectivity Indicator Button */}
        <button
          type="button"
          onClick={() => void handleSyncClick()}
          disabled={isSyncing}
          title={
            isOnline
              ? "Connected to central backend API. Click to trigger immediate sync."
              : isElectron
                ? "Disconnected from API. Offline-first SQLite active (sales queued locally)."
                : "Disconnected from backend API. Click to check health."
          }
          className={[
            "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer",
            isOnline
              ? "bg-signal-green/10 text-signal-green border-signal-green/30 hover:bg-signal-green/15"
              : "bg-signal-amber/10 text-signal-amber border-signal-amber/30 hover:bg-signal-amber/15",
          ].join(" ")}
        >
          {isOnline ? (
            <RefreshCw
              className={`size-3 shrink-0 ${isSyncing ? "animate-spin" : ""}`}
            />
          ) : (
            <CloudOff className="size-3 shrink-0" />
          )}

          <span className="hidden md:inline text-[11px]">
            {isSyncing ? "Syncing…" : isOnline ? "Online" : "Disconnected"}
          </span>

          {pending > 0 && (
            <span className="font-mono rounded-full bg-signal-amber/20 px-1.5 py-0.2 text-[9px] font-bold text-signal-amber ml-0.5">
              {pending} queued
            </span>
          )}
        </button>

        {/* Live Clock */}
        <time
          className="font-mono text-base font-bold text-(--pos-text-2) hidden sm:inline"
          dateTime={clock.toISOString()}
        >
          {clock.toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
      </div>
    </header>
  );
}
