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
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!hasBridge()) return;
    let live = true;
    void window.devsfleet.sync.status().then((s) => live && setSync(s));
    return window.devsfleet.sync.onStatusChange(setSync);
  }, []);

  const online = sync?.online ?? false;
  const pending = sync?.pendingPushCount ?? 0;

  return (
    <header className="flex h-13 shrink-0 items-center justify-between gap-4 border-b border-steel-700 bg-steel-850 px-4">
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-2.5">
          <Store className="size-4 text-brass" aria-hidden />
          <div className="leading-tight">
            <div className="text-[13px] font-semibold">{terminal?.branchName}</div>
            <div className="num text-[10px] text-zinc-500">{terminal?.deviceName}</div>
          </div>
        </div>

        <div className="h-7 w-px bg-steel-700" />

        <div className="flex items-center gap-2 text-[13px]">
          <User className="size-4 text-zinc-500" aria-hidden />
          <span className={cashier ? "font-medium" : "text-zinc-500"}>
            {cashier?.name ?? "Not signed in"}
          </span>
          {cashier && (
            <span className="rounded bg-steel-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
              {cashier.roleName}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Drawer state. Absent means no session is open and cash cannot be taken. */}
        <div className="flex items-center gap-2 text-[13px]">
          <Wallet
            className={cashSessionFloat ? "size-4 text-signal-green" : "size-4 text-zinc-500"}
            aria-hidden
          />
          {cashSessionFloat ? (
            <span className="num">{amount(Money.toMinor(cashSessionFloat))}</span>
          ) : (
            <span className="text-zinc-500">Drawer closed</span>
          )}
        </div>

        <div className="h-7 w-px bg-steel-700" />

        <button
          type="button"
          onClick={onSyncNow}
          disabled={!hasBridge()}
          title={
            dataMode === "browser"
              ? "Running in a browser — no sync engine attached"
              : online
                ? "Synced. Click to sync now."
                : "Offline. Sales are queued locally and will push when the connection returns."
          }
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] transition-colors hover:bg-steel-800 disabled:cursor-default disabled:hover:bg-transparent"
        >
          {online ? (
            <RefreshCw
              className={`size-3.5 text-signal-green ${sync?.syncing ? "animate-spin" : ""}`}
              aria-hidden
            />
          ) : (
            <CloudOff className="size-3.5 text-signal-amber" aria-hidden />
          )}
          <span className={online ? "text-signal-green" : "text-signal-amber"}>
            {online ? "Online" : "Offline"}
          </span>
          {pending > 0 && (
            <span className="num rounded-full bg-signal-amber/20 px-1.5 py-0.5 text-[10px] font-semibold text-signal-amber">
              {pending} queued
            </span>
          )}
        </button>

        <time
          className="num text-[13px] text-zinc-400"
          dateTime={clock.toISOString()}
        >
          {clock.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
        </time>
      </div>
    </header>
  );
}
