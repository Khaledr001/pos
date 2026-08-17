import type { SyncStatusSnapshot } from "@devsfleet/shared-types";
import { CloudOff, RefreshCw, Store, User, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { dataMode, hasBridge } from "../lib/pos-data.js";
import { amount } from "../lib/money.js";
import { useAuth } from "../store/auth.js";
import { Money } from "@devsfleet/shared-utils";

/**
 * Status strip.
 *
 * Answers the four questions a cashier or a manager asks without being asked:
 * which branch and till am I on, who is signed in, is the drawer open, and is
 * this terminal talking to the server.
 *
 * The sync state is deliberately prominent. A till that has been quietly
 * offline for two days still sells perfectly well — and that is exactly the
 * problem, because nobody notices until the stock figures are a day stale.
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

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (hasBridge()) {
      let live = true;
      void window.devsfleet.sync.status().then((s) => live && setSync(s));
      return window.devsfleet.sync.onStatusChange(setSync);
    } else {
      // Browser mode: poll API health
      const checkApiHealth = async () => {
        try {
          const rawUrl = (import.meta.env.VITE_API_URL as string | undefined) || "http://localhost:3001/api/v1";
          const parsed = new URL(rawUrl);
          const healthUrl = `${parsed.origin}/health`;
          const res = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) });
          setBrowserApiOnline(res.ok);
        } catch {
          setBrowserApiOnline(false);
        }
      };

      void checkApiHealth();
      const healthTimer = setInterval(() => void checkApiHealth(), 10_000);
      return () => clearInterval(healthTimer);
    }
  }, []);

  const isElectron = hasBridge();
  const isOnline = isElectron ? (sync?.online ?? false) : browserApiOnline;
  const pending = sync?.pendingPushCount ?? 0;

  return (
    <header className="flex h-13 shrink-0 items-center justify-between gap-4 border-b border-pos-border bg-pos-panel px-4">
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-2.5">
          <Store className="size-4 text-brass" aria-hidden />
          <div className="leading-tight">
            <div className="text-[13px] font-semibold">{terminal?.branchName}</div>
            <div className="num text-[10px] text-pos-text-3">{terminal?.deviceName}</div>
          </div>
        </div>

        <div className="h-7 w-px bg-pos-border" />

        <div className="flex items-center gap-2 text-[13px]">
          <User className="size-4 text-zinc-500" aria-hidden />
          <span className={cashier ? "font-medium" : "text-pos-text-3"}>
            {cashier?.name ?? "Not signed in"}
          </span>
          {cashier && (
            <span className="rounded bg-pos-raised px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-pos-text-2">
              {cashier.roleName}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Drawer state. Absent means no session is open and cash cannot be taken. */}
        <div className="flex items-center gap-2 text-[13px]">
          <Wallet
            className={cashSessionFloat ? "size-4 text-signal-green" : "size-4 text-pos-text-3"}
            aria-hidden
          />
          {cashSessionFloat ? (
            <span className="num">{amount(Money.toMinor(cashSessionFloat))}</span>
          ) : (
            <span className="text-pos-text-3">Drawer closed</span>
          )}
        </div>

        <div className="h-7 w-px bg-pos-border" />

        <button
          type="button"
          onClick={onSyncNow}
          disabled={!hasBridge()}
          title={
            isOnline
              ? "Online connected to central backend API. Click to sync now."
              : isElectron
                ? "Disconnected from API. Proceeding with local SQLite mirror (sales queued locally)."
                : "Disconnected from backend API. Proceeding with offline sample data."
          }
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] transition-colors hover:bg-pos-raised disabled:cursor-default disabled:hover:bg-transparent"
        >
          {isOnline ? (
            <RefreshCw
              className={`size-3.5 text-signal-green ${sync?.syncing ? "animate-spin" : ""}`}
              aria-hidden
            />
          ) : (
            <CloudOff className="size-3.5 text-signal-amber" aria-hidden />
          )}
          <span className={isOnline ? "text-signal-green font-medium" : "text-signal-amber font-medium"}>
            {isOnline ? "Online connected" : "Disconnected"}
          </span>
          {pending > 0 && (
            <span className="num rounded-full bg-signal-amber/20 px-1.5 py-0.5 text-[10px] font-semibold text-signal-amber">
              {pending} queued
            </span>
          )}
        </button>

        <time
          className="num text-[13px] text-pos-text-2"
          dateTime={clock.toISOString()}
        >
          {clock.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
        </time>
      </div>
    </header>
  );
}
