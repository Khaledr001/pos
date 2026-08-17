import type { PrintFormat, SyncStatusSnapshot } from "@devsfleet/shared-types";
import { Cpu, LogOut, Moon, Printer, RefreshCw, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { KeyRail } from "../components/KeyRail.js";
import { clearPosApiSession, dataMode, hasBridge } from "../lib/pos-data.js";
import { applyTheme, type PosTheme } from "../main.js";
import { useAuth } from "../store/auth.js";

/**
 * Terminal settings.
 *
 * Intentionally thin. This screen is for the person installing or fixing a
 * till, not for the cashier using it — anything a cashier needs mid-shift
 * belongs on the sale screen where their hands already are.
 */
export function Settings() {
  const { cashier, terminal, signOut } = useAuth();
  const [device, setDevice] = useState<{
    deviceId: string | null;
    hardwareId: string;
    version: string;
  } | null>(null);
  const [sync, setSync] = useState<SyncStatusSnapshot | null>(null);
  const [printResult, setPrintResult] = useState<string | null>(null);
  const [theme, setTheme] = useState<PosTheme>(
    () => (document.documentElement.getAttribute("data-theme") as PosTheme) ?? "light",
  );

  function toggleTheme() {
    const next: PosTheme = theme === "light" ? "dark" : "light";
    applyTheme(next);
    setTheme(next);
  }

  function handleSignOut() {
    clearPosApiSession();
    signOut();
  }

  useEffect(() => {
    if (!hasBridge()) return;
    void window.devsfleet.device.info().then(setDevice);
    void window.devsfleet.sync.status().then(setSync);
  }, []);

  async function testPrint(format: PrintFormat) {
    if (!hasBridge()) return;
    try {
      await window.devsfleet.printer.printTest(format);
      setPrintResult(`Sent a test page to the ${format.replace("_", " ")} printer.`);
    } catch (error) {
      setPrintResult(error instanceof Error ? error.message : "Printing failed.");
    }
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl space-y-4">
          <Section title="Terminal" icon={Cpu}>
            <Field label="Business" value={terminal?.tenantName ?? "—"} />
            <Field label="Branch" value={terminal?.branchName ?? "—"} />
            <Field label="Till" value={terminal?.deviceName ?? "—"} mono />
            <Field label="Device ID" value={device?.deviceId ?? "Not activated"} mono />
            <Field label="App version" value={device?.version ?? "—"} mono />
            <Field
              label="Data source"
              value={
                dataMode === "electron"
                  ? "Local SQLite, via the Electron bridge"
                  : dataMode === "api"
                    ? "Live API (browser + network)"
                    : "In-memory sample data (browser preview)"
              }
            />
          </Section>

          <Section title="Sync" icon={RefreshCw}>
            <Field
              label="Connection"
              value={sync?.online ? "Online" : "Offline"}
              tone={sync?.online ? "green" : "amber"}
            />
            <Field
              label="Queued for upload"
              value={String(sync?.pendingPushCount ?? 0)}
              mono
            />
            <Field label="Needs attention" value={String(sync?.failedPushCount ?? 0)} mono />
            <Field
              label="Last sync"
              value={
                sync?.lastPullAt
                  ? new Date(sync.lastPullAt).toLocaleString("en-GB")
                  : "Never"
              }
            />
            <p className="pt-1 text-[12px] text-zinc-500">
              Sales made offline stay on this terminal until they upload. Do not
              reinstall the app while anything is queued.
            </p>
          </Section>

          <Section title="Hardware" icon={Printer}>
            <div className="flex flex-wrap gap-2">
              {(["thermal_58", "thermal_80", "a4"] as PrintFormat[]).map((format) => (
                <button
                  key={format}
                  type="button"
                  className="btn btn-ghost"
                  disabled={!hasBridge()}
                  onClick={() => testPrint(format)}
                >
                  Test {format === "a4" ? "A4" : `${format.split("_")[1]}mm`}
                </button>
              ))}
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!hasBridge()}
                onClick={() => window.devsfleet.cashDrawer.open("Manual test")}
              >
                Open drawer
              </button>
            </div>
            {printResult && (
              <p className="mt-3 text-[12px] text-zinc-400">{printResult}</p>
            )}
            {!hasBridge() && (
              <p className="mt-3 text-[12px] text-zinc-500">
                Hardware is only reachable from the Electron app, not a browser
                preview.
              </p>
            )}
          </Section>

          <Section title="Appearance" icon={Sun}>
            <div className="flex items-center justify-between">
              <span className="text-[13px]" style={{ color: "var(--pos-text-2)" }}>
                Theme
              </span>
              <button
                type="button"
                id="theme-toggle"
                onClick={toggleTheme}
                className="btn btn-ghost gap-2 text-[13px]"
                aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
              >
                {theme === "light" ? (
                  <>
                    <Moon className="size-4" aria-hidden />
                    Dark mode
                  </>
                ) : (
                  <>
                    <Sun className="size-4" aria-hidden />
                    Light mode
                  </>
                )}
              </button>
            </div>
            <p className="text-[12px]" style={{ color: "var(--pos-text-3)" }}>
              Choose the look that works best under your shop lighting. Your
              preference is saved on this terminal.
            </p>
          </Section>

          <Section title="Shift" icon={LogOut}>
            <Field label="Signed in as" value={cashier?.name ?? "—"} />
            <Field label="Role" value={cashier?.roleName ?? "—"} />
            <button type="button" className="btn btn-danger mt-2" onClick={handleSignOut}>
              <LogOut className="size-4" aria-hidden />
              End shift and sign out
            </button>
            <p className="mt-2 text-[12px] text-zinc-500">
              Signing out does not close the cash drawer. Close it first so the
              count is recorded against your shift.
            </p>
          </Section>
        </div>
      </div>

      <KeyRail
        actions={[{ combo: "Esc", label: "Back to sale", onPress: () => history.back() }]}
      />
    </>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Cpu;
  children: React.ReactNode;
}) {
  return (
    <section className="panel p-5">
      <h2 className="mb-4 flex items-center gap-2 text-[13px] font-semibold">
        <Icon className="size-4 text-brass" aria-hidden />
        {title}
      </h2>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "green" | "amber";
}) {
  const colours = { green: "text-signal-green", amber: "text-signal-amber" };
  return (
    <div className="flex items-baseline justify-between gap-4 text-[13px]">
      <span className="shrink-0 text-zinc-400">{label}</span>
      <span
        className={[
          "truncate text-right",
          mono ? "num text-[12px]" : "",
          tone ? colours[tone] : "text-chalk",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}
