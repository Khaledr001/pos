import type { PrintFormat, SyncStatusSnapshot } from "@devsfleet/shared-types";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Cpu,
  HardDrive,
  Loader2,
  LogOut,
  Moon,
  Printer,
  RefreshCw,
  Search,
  Store,
  Sun,
  Unplug,
  Zap,
} from "lucide-react";
import React, { useEffect, useState } from "react";
import { KeyRail } from "../components/KeyRail.js";
import { Select } from "../components/Select.js";
import {
  clearPosApiSession,
  dataMode,
  hasBridge,
  posData,
  type PosSaleReceipt,
} from "../lib/pos-data.js";
import { applyTheme, type PosTheme } from "../main.js";
import { useAuth } from "../store/auth.js";

/**
 * Terminal Settings & Diagnostics.
 *
 * Designed for shop managers and technicians:
 * - Terminal identity & hardware status
 * - Sync health & outbox reconciliation
 * - Thermal printer configuration & test printing
 * - Cash drawer testing
 * - Historical invoice duplicate reprinting
 * - Display theme & shift sign-out
 */
export function Settings() {
  const { cashier, terminal, signOut, unbindTerminal, can } = useAuth();

  const [unpairing, setUnpairing] = useState(false);
  const [unpairError, setUnpairError] = useState<string | null>(null);

  const [device, setDevice] = useState<{
    deviceId: string | null;
    hardwareId: string;
    version: string;
  } | null>(null);

  const [sync, setSync] = useState<SyncStatusSnapshot | null>(null);
  const [syncingNow, setSyncingNow] = useState(false);

  const [attention, setAttention] = useState<
    Array<{
      localId: string;
      entity: string;
      kind: "rejected" | "warning";
      reason: string;
      occurredAt: string;
      attempts: number;
    }>
  >([]);

  const [printResult, setPrintResult] = useState<{
    text: string;
    tone: "green" | "red" | "neutral";
  } | null>(null);

  const [theme, setTheme] = useState<PosTheme>(
    () => (document.documentElement.getAttribute("data-theme") as PosTheme) ?? "light",
  );

  // Printer configuration
  const [devicePath, setDevicePath] = useState("");
  const [defaultFormat, setDefaultFormat] = useState<PrintFormat>("thermal_80");
  const [savingConfig, setSavingConfig] = useState(false);
  const [testingFormat, setTestingFormat] = useState<string | null>(null);
  const [drawerTesting, setDrawerTesting] = useState(false);

  // Reprint Receipt state
  const [reprintQuery, setReprintQuery] = useState("");
  const [reprintSale, setReprintSale] = useState<PosSaleReceipt | null>(null);
  const [reprintLoading, setReprintLoading] = useState(false);
  const [reprinting, setReprinting] = useState(false);
  const [reprintError, setReprintError] = useState<string | null>(null);

  function toggleTheme(nextTheme?: PosTheme) {
    const next: PosTheme = nextTheme ?? (theme === "light" ? "dark" : "light");
    applyTheme(next);
    setTheme(next);
  }

  function handleSignOut() {
    clearPosApiSession();
    signOut();
  }

  async function handleUnpair() {
    setUnpairError(null);
    const business = terminal?.tenantName ?? "its current business";
    const confirmed = confirm(
      `Unpair this terminal from ${business}?\n\n` +
        "This wipes every product, price, customer and staff PIN cached on this " +
        "till and cannot be undone. Only do this once every sale here has synced " +
        "— unpairing is refused otherwise, but check the Sync & Connectivity " +
        "panel above first.",
    );
    if (!confirmed) return;

    setUnpairing(true);
    try {
      await window.devsfleet.device.unpair();
      unbindTerminal();
    } catch (error) {
      setUnpairError(error instanceof Error ? error.message : "Failed to unpair this terminal.");
    } finally {
      setUnpairing(false);
    }
  }

  function refreshAttention() {
    if (!hasBridge()) return;
    void window.devsfleet.outbox.attentionItems().then(setAttention);
  }

  useEffect(() => {
    if (!hasBridge()) return;

    void window.devsfleet.device.info().then(setDevice);
    void window.devsfleet.sync.status().then(setSync);
    void window.devsfleet.printer.getConfig().then((config) => {
      setDevicePath(config.devicePath);
      setDefaultFormat(config.format);
    });
    refreshAttention();

    const unsubscribe = window.devsfleet.sync.onStatusChange((newStatus) => {
      setSync(newStatus);
      refreshAttention();
    });
    return unsubscribe;
  }, []);

  async function triggerManualSync() {
    if (!hasBridge()) return;
    setSyncingNow(true);
    try {
      const st = await window.devsfleet.sync.now();
      setSync(st);
      refreshAttention();
      setPrintResult({ text: "Sync cycle completed successfully.", tone: "green" });
    } catch (err) {
      setPrintResult({
        text: err instanceof Error ? err.message : "Sync failed.",
        tone: "red",
      });
    } finally {
      setSyncingNow(false);
    }
  }

  async function retryItem(localId: string) {
    await window.devsfleet.outbox.retry(localId);
    refreshAttention();
  }

  async function discardItem(localId: string) {
    if (!confirm("Give up on this sale? It stays on record as discarded but will never be uploaded.")) return;
    await window.devsfleet.outbox.discard(localId);
    refreshAttention();
  }

  async function acknowledgeItem(localId: string) {
    await window.devsfleet.outbox.acknowledgeWarning(localId);
    refreshAttention();
  }

  async function testPrint(format: PrintFormat) {
    if (!hasBridge()) {
      setPrintResult({
        text: "Printer hardware is only accessible via the Electron desktop application.",
        tone: "neutral",
      });
      return;
    }
    setTestingFormat(format);
    setPrintResult(null);
    try {
      await window.devsfleet.printer.printTest(format);
      setPrintResult({
        text: `Test page sent to ${format.replace("_", " ")} printer.`,
        tone: "green",
      });
    } catch (error) {
      setPrintResult({
        text: error instanceof Error ? error.message : "Printing failed.",
        tone: "red",
      });
    } finally {
      setTestingFormat(null);
    }
  }

  async function testDrawer() {
    if (!hasBridge()) {
      setPrintResult({
        text: "Cash drawer trigger is only accessible via the Electron desktop application.",
        tone: "neutral",
      });
      return;
    }
    setDrawerTesting(true);
    setPrintResult(null);
    try {
      await window.devsfleet.cashDrawer.open("Manual test from Settings");
      setPrintResult({ text: "Cash drawer pulse signal sent.", tone: "green" });
    } catch (error) {
      setPrintResult({
        text: error instanceof Error ? error.message : "Failed to trigger drawer pulse.",
        tone: "red",
      });
    } finally {
      setDrawerTesting(false);
    }
  }

  async function savePrinterConfig() {
    if (!hasBridge()) return;
    setSavingConfig(true);
    setPrintResult(null);
    try {
      await window.devsfleet.printer.setConfig({ devicePath, format: defaultFormat });
      setPrintResult({ text: "Printer settings saved successfully.", tone: "green" });
    } catch (error) {
      setPrintResult({
        text: error instanceof Error ? error.message : "Failed to save printer settings.",
        tone: "red",
      });
    } finally {
      setSavingConfig(false);
    }
  }

  async function findForReprint() {
    setReprintError(null);
    setReprintSale(null);
    const q = reprintQuery.trim();
    if (!q) return;

    setReprintLoading(true);
    try {
      const sale = await posData.findSale(q);
      if (!sale) {
        setReprintError(`No sale found matching "${q}".`);
        return;
      }
      setReprintSale(sale);
    } catch (error) {
      setReprintError(error instanceof Error ? error.message : "Lookup failed.");
    } finally {
      setReprintLoading(false);
    }
  }

  async function reprintSaleReceipt() {
    if (!reprintSale) return;
    setReprinting(true);
    setReprintError(null);
    try {
      if (hasBridge()) {
        // Always marked DUPLICATE — this is never the first copy off the till.
        await window.devsfleet.printer.printReceipt(reprintSale.localId, undefined, true);
        setPrintResult({
          text: `Reprinted ${reprintSale.saleNumber ?? reprintSale.localId} (marked DUPLICATE).`,
          tone: "green",
        });
      } else {
        // Browser fallback: trigger native window print preview
        window.print();
        setPrintResult({
          text: `Printed invoice ${reprintSale.saleNumber ?? reprintSale.localId} via browser dialog.`,
          tone: "green",
        });
      }
    } catch (error) {
      setReprintError(error instanceof Error ? error.message : "Printing failed.");
    } finally {
      setReprinting(false);
    }
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6 bg-(--pos-bg)">
        <div className="mx-auto max-w-5xl space-y-5">
          {/* ── Page Header ── */}
          <div className="flex items-center justify-between border-b border-(--pos-border) pb-4">
            <div>
              <h1 className="text-lg font-bold tracking-tight text-(--pos-text)">
                Terminal Settings & Diagnostics
              </h1>
              <p className="text-xs text-(--pos-text-3) mt-0.5">
                Hardware connections, sync telemetry, outbox reconciliation and reprint tools
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold border",
                  hasBridge()
                    ? "bg-signal-green/10 text-signal-green border-signal-green/30"
                    : "bg-signal-amber/10 text-signal-amber border-signal-amber/30",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    hasBridge() ? "bg-signal-green" : "bg-signal-amber",
                  )}
                />
                {hasBridge() ? "Electron Desktop Mode" : "Browser Preview Mode"}
              </span>
            </div>
          </div>

          {/* ── Attention Banner (If any outbox issues exist) ── */}
          {attention.length > 0 && (
            <Section title="Sync Attention Queue" icon={AlertTriangle} tone="amber">
              <div className="space-y-2.5">
                {attention.map((item) => (
                  <div
                    key={item.localId}
                    className="rounded-xl border border-signal-amber/30 bg-signal-amber/5 p-3.5"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-xs font-bold text-(--pos-text)">
                        {item.entity} · {new Date(item.occurredAt).toLocaleString("en-GB")}
                      </span>
                      <span
                        className={cn(
                          "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded",
                          item.kind === "rejected"
                            ? "bg-signal-red/10 text-signal-red"
                            : "bg-signal-amber/10 text-signal-amber",
                        )}
                      >
                        {item.kind === "rejected" ? "Rejected" : "Warning"}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-(--pos-text-2)">{item.reason}</p>
                    <div className="mt-3 flex gap-2">
                      {item.kind === "rejected" ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-ghost text-xs"
                            onClick={() => void retryItem(item.localId)}
                          >
                            <RefreshCw className="size-3.5 mr-1" />
                            Retry Sync
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger text-xs"
                            onClick={() => void discardItem(item.localId)}
                          >
                            Discard
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-ghost text-xs"
                          onClick={() => void acknowledgeItem(item.localId)}
                        >
                          <CheckCircle2 className="size-3.5 mr-1" />
                          Dismiss Warning
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="pt-1 text-[11px] text-(--pos-text-3)">
                <strong>Rejected</strong> sales were refused by the backend. Retry after fixing the constraint, or discard.
              </p>
            </Section>
          )}

          {/* ── 2-Column Responsive Layout ── */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* ── LEFT COLUMN ── */}
            <div className="space-y-5">
              {/* Terminal Details */}
              <Section title="Terminal Identity" icon={Cpu}>
                <div className="divide-y divide-(--pos-border)/60">
                  <Field label="Business" value={terminal?.tenantName ?? "—"} />
                  <Field label="Branch" value={terminal?.branchName ?? "—"} />
                  <Field label="Till Name" value={terminal?.deviceName ?? "—"} mono />
                  <Field label="Device ID" value={device?.deviceId ?? "Not activated"} mono />
                  <Field label="App Version" value={device?.version ?? "1.0.0"} mono />
                  <Field
                    label="Data Mode"
                    value={
                      dataMode === "electron"
                        ? "Local SQLite (Offline-first)"
                        : dataMode === "api"
                          ? "Central API (Network)"
                          : "In-memory Mock Preview"
                    }
                  />
                </div>
              </Section>

              {/* Sync Status */}
              <Section title="Sync & Connectivity" icon={RefreshCw}>
                <div className="divide-y divide-(--pos-border)/60">
                  <Field
                    label="Connection"
                    value={sync?.online ? "Online (Live API Connected)" : "Offline (Local Queue)"}
                    tone={sync?.online ? "green" : "amber"}
                  />
                  <Field
                    label="Queued for Upload"
                    value={String(sync?.pendingPushCount ?? 0)}
                    mono
                  />
                  <Field
                    label="Failed / Attention"
                    value={String(sync?.failedPushCount ?? 0)}
                    mono
                    tone={(sync?.failedPushCount ?? 0) > 0 ? "red" : undefined}
                  />
                  <Field
                    label="Last Background Sync"
                    value={
                      sync?.lastPullAt
                        ? new Date(sync.lastPullAt).toLocaleTimeString("en-GB", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })
                        : "Never"
                    }
                  />
                </div>

                <div className="mt-3 flex items-center justify-between pt-2 border-t border-(--pos-border)/60">
                  <button
                    type="button"
                    className="btn btn-ghost text-xs"
                    disabled={!hasBridge() || syncingNow}
                    onClick={() => void triggerManualSync()}
                  >
                    <RefreshCw className={cn("size-3.5 mr-1", syncingNow && "animate-spin")} />
                    {syncingNow ? "Syncing now…" : "Force Sync Now"}
                  </button>
                  <span className="text-[11px] text-(--pos-text-3)">
                    Auto-polls every 30 seconds
                  </span>
                </div>
              </Section>

              {/* Shift & Session */}
              <Section title="Current Shift" icon={LogOut}>
                <div className="divide-y divide-(--pos-border)/60">
                  <Field label="Active Cashier" value={cashier?.name ?? "—"} />
                  <Field label="Role" value={cashier?.roleName ?? "—"} />
                </div>

                <div className="mt-4 pt-2 border-t border-(--pos-border)/60">
                  <button
                    type="button"
                    className="btn btn-danger w-full justify-center"
                    onClick={handleSignOut}
                  >
                    <LogOut className="size-4 mr-1.5" />
                    End Shift & Sign Out
                  </button>
                  <p className="mt-2 text-center text-[11px] text-(--pos-text-3)">
                    Close your cash drawer count on the main sale screen before signing out.
                  </p>
                </div>
              </Section>

              {/* Terminal / tenant unpair — hidden entirely for a cashier who does not hold device:manage */}
              {can("device:manage") && (
                <Section title="Danger Zone" icon={Unplug} tone="amber">
                  <p className="text-xs text-(--pos-text-2)">
                    Disconnect this till from <strong>{terminal?.tenantName ?? "its current business"}</strong>{" "}
                    entirely — for re-registering it to a different business or branch. This wipes every
                    product, price, customer and staff PIN cached locally on this device.
                  </p>

                  {unpairError && (
                    <div className="rounded-lg bg-signal-red/10 border border-signal-red/30 p-2.5 text-xs text-signal-red font-medium">
                      {unpairError}
                    </div>
                  )}

                  <button
                    type="button"
                    className="btn btn-danger w-full justify-center"
                    disabled={!hasBridge() || unpairing}
                    onClick={() => void handleUnpair()}
                  >
                    {unpairing ? (
                      <Loader2 className="size-4 mr-1.5 animate-spin" />
                    ) : (
                      <Unplug className="size-4 mr-1.5" />
                    )}
                    {unpairing ? "Unpairing…" : "Unpair This Terminal"}
                  </button>
                  {!hasBridge() && (
                    <p className="text-[11px] text-(--pos-text-3) italic">
                      Only available in the Electron desktop application.
                    </p>
                  )}
                </Section>
              )}
            </div>

            {/* ── RIGHT COLUMN ── */}
            <div className="space-y-5">
              {/* Receipt Reprinting */}
              <Section title="Receipt Lookup & Reprint" icon={Copy}>
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-(--pos-text-3)" />
                      <input
                        type="text"
                        value={reprintQuery}
                        onChange={(e) => {
                          setReprintQuery(e.target.value);
                          setReprintError(null);
                        }}
                        onKeyDown={(e) => e.key === "Enter" && void findForReprint()}
                        placeholder="Invoice # or receipt reference..."
                        className="field num pl-9 text-xs"
                      />
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary text-xs px-4"
                      disabled={reprintLoading || !reprintQuery.trim()}
                      onClick={() => void findForReprint()}
                    >
                      {reprintLoading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        "Find"
                      )}
                    </button>
                  </div>

                  {reprintError && (
                    <div className="rounded-lg bg-signal-red/10 border border-signal-red/30 p-2.5 text-xs text-signal-red font-medium">
                      {reprintError}
                    </div>
                  )}

                  {reprintSale && (
                    <div className="rounded-xl border border-(--pos-border) bg-(--pos-raised) p-3.5 space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-mono font-bold text-sm text-(--pos-text)">
                            {reprintSale.saleNumber ?? `Draft — ${reprintSale.localId.slice(0, 8)}`}
                          </p>
                          <p className="text-[11px] text-(--pos-text-3)">
                            {new Date(reprintSale.occurredAt).toLocaleString("en-GB")} ·{" "}
                            {reprintSale.lines?.length ?? 0} line items
                          </p>
                        </div>
                        <span className="font-mono font-bold text-sm text-(--pos-accent)">
                          AED {parseFloat(reprintSale.total).toFixed(2)}
                        </span>
                      </div>

                      <button
                        type="button"
                        className="btn btn-ghost w-full justify-center text-xs"
                        disabled={reprinting}
                        onClick={() => void reprintSaleReceipt()}
                      >
                        {reprinting ? (
                          <Loader2 className="size-3.5 animate-spin mr-1.5" />
                        ) : (
                          <Copy className="size-3.5 mr-1.5" />
                        )}
                        {reprinting ? "Printing..." : "Reprint Receipt (marked DUPLICATE)"}
                      </button>
                    </div>
                  )}
                </div>
              </Section>

              {/* Hardware: Thermal Printer & Drawer */}
              <Section title="Hardware: Printer & Cash Drawer" icon={Printer}>
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-medium text-(--pos-text-2) space-y-1 block">
                      <span>Printer Device Path</span>
                      <input
                        type="text"
                        value={devicePath}
                        onChange={(e) => setDevicePath(e.target.value)}
                        placeholder="/dev/usb/lp0 or COM1"
                        className="field num text-xs"
                        disabled={!hasBridge()}
                      />
                    </label>

                    <div className="text-xs font-medium text-(--pos-text-2) space-y-1 block">
                      <span className="block">Default Paper Format</span>
                      <Select
                        value={defaultFormat}
                        onChange={(val) => setDefaultFormat(val as PrintFormat)}
                        disabled={!hasBridge()}
                        options={[
                          { value: "thermal_80", label: "80mm Thermal (Standard Receipt)" },
                          { value: "thermal_58", label: "58mm Thermal (Compact Receipt)" },
                        ]}
                        className="w-full"
                        size="md"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      className="btn btn-ghost text-xs"
                      disabled={!hasBridge() || savingConfig}
                      onClick={() => void savePrinterConfig()}
                    >
                      {savingConfig ? (
                        <Loader2 className="size-3.5 animate-spin mr-1" />
                      ) : (
                        <HardDrive className="size-3.5 mr-1" />
                      )}
                      {savingConfig ? "Saving..." : "Save Printer Configuration"}
                    </button>

                    <button
                      type="button"
                      className="btn btn-ghost text-xs text-signal-green border-signal-green/30 hover:bg-signal-green/10"
                      disabled={!hasBridge() || drawerTesting}
                      onClick={() => void testDrawer()}
                    >
                      <Zap className="size-3.5 mr-1" />
                      {drawerTesting ? "Testing..." : "Open Drawer (Pulse)"}
                    </button>
                  </div>

                  {/* Test Prints */}
                  <div className="border-t border-(--pos-border)/60 pt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-(--pos-text-3) mb-2">
                      Printer Output Diagnostics
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(["thermal_80", "thermal_58", "a4"] as PrintFormat[]).map((fmt) => (
                        <button
                          key={fmt}
                          type="button"
                          className="btn btn-ghost text-xs py-1.5"
                          disabled={!hasBridge() || testingFormat !== null}
                          onClick={() => testPrint(fmt)}
                        >
                          {testingFormat === fmt ? (
                            <Loader2 className="size-3 animate-spin mr-1" />
                          ) : (
                            <Printer className="size-3 mr-1 text-(--pos-text-3)" />
                          )}
                          Test {fmt === "a4" ? "A4 Full Page" : `${fmt.split("_")[1]}mm Receipt`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {printResult && (
                    <div
                      className={cn(
                        "rounded-lg p-2.5 text-xs font-medium border mt-2",
                        printResult.tone === "green"
                          ? "bg-signal-green/10 text-signal-green border-signal-green/30"
                          : printResult.tone === "red"
                            ? "bg-signal-red/10 text-signal-red border-signal-red/30"
                            : "bg-(--pos-raised) text-(--pos-text-2) border-(--pos-border)",
                      )}
                    >
                      {printResult.text}
                    </div>
                  )}

                  {!hasBridge() && (
                    <p className="text-[11px] text-(--pos-text-3) italic">
                      Hardware direct ESC/POS printer & drawer commands are available when running inside the Electron POS wrapper.
                    </p>
                  )}
                </div>
              </Section>

              {/* Display & Appearance */}
              <Section title="Appearance" icon={Sun}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-(--pos-text) block">
                      Color Theme
                    </span>
                    <span className="text-[11px] text-(--pos-text-3)">
                      Optimized for trade counter and warehouse lighting
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 rounded-xl bg-(--pos-raised) p-1 border border-(--pos-border)">
                    <button
                      type="button"
                      onClick={() => toggleTheme("light")}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                        theme === "light"
                          ? "bg-(--pos-panel) text-(--pos-text) shadow-xs"
                          : "text-(--pos-text-3) hover:text-(--pos-text)",
                      )}
                    >
                      <Sun className="size-3.5 text-amber-500" />
                      Light
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleTheme("dark")}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                        theme === "dark"
                          ? "bg-(--pos-panel) text-(--pos-text) shadow-xs"
                          : "text-(--pos-text-3) hover:text-(--pos-text)",
                      )}
                    >
                      <Moon className="size-3.5 text-indigo-400" />
                      Dark
                    </button>
                  </div>
                </div>
              </Section>
            </div>
          </div>
        </div>
      </div>

      <KeyRail
        actions={[{ combo: "Esc", label: "Back to sale", onPress: () => history.back() }]}
      />
    </>
  );
}

// ── Helper Sub-Components ─────────────────────────────────────────────────────

function Section({
  title,
  icon: Icon,
  tone,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "amber" | "green";
  children: React.ReactNode;
}) {
  return (
    <section className="panel p-5 border border-(--pos-border) rounded-2xl bg-(--pos-panel) shadow-xs">
      <h2 className="mb-3.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-(--pos-text)">
        <Icon
          className={cn(
            "size-4 shrink-0",
            tone === "amber" ? "text-signal-amber" : "text-(--pos-accent)",
          )}
        />
        <span>{title}</span>
      </h2>
      <div className="space-y-3">{children}</div>
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
  tone?: "green" | "amber" | "red";
}) {
  const tones = {
    green: "text-signal-green font-semibold",
    amber: "text-signal-amber font-semibold",
    red: "text-signal-red font-semibold",
  };

  return (
    <div className="flex items-center justify-between gap-4 py-2 text-xs">
      <span className="shrink-0 text-(--pos-text-3)">{label}</span>
      <span
        className={cn(
          "truncate text-right font-medium",
          mono ? "num text-xs font-mono" : "",
          tone ? tones[tone] : "text-(--pos-text)",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}
