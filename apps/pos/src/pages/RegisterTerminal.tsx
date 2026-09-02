import { ArrowLeft, Lock, Loader2, Mail, MonitorSmartphone, Tag } from "lucide-react";
import { useState } from "react";
import { Select } from "../components/Select.js";
import { clearApiTokens } from "../lib/api-client.js";
import {
  adminLoginForRegistration,
  fetchBranchesForRegistration,
  hasBridge,
  registerDeviceOnServer,
} from "../lib/pos-data.js";
import { useAuth } from "../store/auth.js";

export function RegisterTerminal() {
  const { bindTerminal } = useAuth();
  const [step, setStep] = useState<"login" | "details">("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Login form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Details form state
  const [tenantName, setTenantName] = useState("");
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [deviceName, setDeviceName] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const user = await adminLoginForRegistration(email, password);
      setTenantName(user.tenantName);
      
      const branchList = await fetchBranchesForRegistration();
      setBranches(branchList);
      const [firstBranch] = branchList;
      if (firstBranch) setSelectedBranch(firstBranch.id);

      setStep("details");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid credentials");
      clearApiTokens(); // Remove broken/partial tokens
    } finally {
      setLoading(false);
    }
  }

  /** Wrong account signed in — back to login rather than being stuck mid-registration. */
  function backToLogin() {
    clearApiTokens();
    setPassword("");
    setError(null);
    setStep("login");
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedBranch || !deviceName.trim()) return;
    
    setLoading(true);
    setError(null);
    try {
      const device = await registerDeviceOnServer(selectedBranch, deviceName.trim());
      const branchName = branches.find((b) => b.id === selectedBranch)?.name ?? "";

      /**
       * Tell the MAIN process, not just this window.
       *
       * `registerDeviceOnServer` only creates the row on the API, over the
       * renderer's own fetch client. `bindTerminal` below only updates this
       * window's own state, persisted to localStorage. Neither one reaches the
       * Electron main process — which is what `auth:pin-login` actually asks —
       * so without this call `device_state` stayed empty forever: the terminal
       * looked registered (the app stopped showing this screen) while every
       * PIN, on every account, failed with "This terminal has not been
       * activated yet".
       *
       * `device:activate` is IPC-only and has always existed for this; nothing
       * before now ever called it.
       */
      if (hasBridge()) {
        const apiUrl =
          (import.meta.env.VITE_API_URL as string | undefined)?.trim() ||
          "http://localhost:3001/api/v1";
        await window.devsfleet.device.activate(`${device.id}:${selectedBranch}`, apiUrl);
      }

      bindTerminal({
        deviceId: device.id,
        deviceName: deviceName.trim(),
        branchId: selectedBranch,
        branchName,
        tenantName,
      });

      // After binding, App.tsx will route to Login because cashier is null.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register terminal");
    } finally {
      /**
       * The administrator's tokens leave with them.
       *
       * Registration is the one moment a shop-floor terminal ever holds a
       * tenant-admin session, and it was keeping it: the refresh token stayed
       * in renderer localStorage indefinitely — not cleared on success, not on
       * sign-out, not on the idle timer. Every till in the estate ended up
       * holding a long-lived admin credential readable from devtools, and the
       * screens that call the API directly transacted with it, attributing a
       * cashier's goods receipts to whoever installed the machine.
       *
       * In `finally` rather than after the success path, because a failure
       * mid-registration leaves exactly the same credential behind.
       */
      clearApiTokens();
      setLoading(false);
    }
  }

  return (
    // Forced dark regardless of the app's saved light/dark preference — this
    // screen's own background (bg-steel-900 below) is unconditionally dark,
    // but `.panel` and `Select` read the theme-aware --pos-* tokens, which
    // default to LIGHT (index.html ships data-theme="light") until a cashier
    // has changed it in Settings — a place nobody has been able to reach yet
    // on a terminal that isn't registered. Without this, a fresh install
    // showed a white card and a white dropdown floating on a black screen.
    <div data-theme="dark" className="flex h-full items-center justify-center bg-steel-900 p-6 text-pos-text">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-brass/12">
            <MonitorSmartphone className="size-6 text-brass" aria-hidden />
          </div>
          <h1 className="text-lg font-semibold">Terminal Registration</h1>
          <p className="mt-1 text-[13px] text-zinc-500">
            {step === "login"
              ? "Sign in as an administrator to bind this device"
              : "Select a branch and name this terminal"}
          </p>
        </div>

        {/* Step indicator */}
        <div className="mb-5 flex items-center justify-center gap-2" aria-hidden>
          <span className="h-1 w-10 rounded-full bg-brass transition-colors" />
          <span
            className={[
              "h-1 w-10 rounded-full transition-colors",
              step === "details" ? "bg-brass" : "bg-steel-700",
            ].join(" ")}
          />
        </div>

        <div className="panel p-6">
          {error && (
            <div className="mb-4 rounded bg-signal-red/10 p-3 text-[13px] text-signal-red">
              {error}
            </div>
          )}

          {step === "login" ? (
            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-pos-text-2">Email</span>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
                  <input
                    autoFocus
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="field pl-9"
                    placeholder="admin@example.com"
                  />
                </div>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-pos-text-2">Password</span>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="field pl-9"
                  />
                </div>
              </label>
              <button
                type="submit"
                disabled={loading}
                className="btn-primary mt-2 flex justify-center py-2.5"
              >
                {loading ? <Loader2 className="size-5 animate-spin" /> : "Sign In"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="flex flex-col gap-4">
              {/* Confirms which business this till is about to belong to —
                  previously captured in state and never shown, so signing in
                  under the wrong admin account produced no visible warning. */}
              <div className="mb-1 flex items-center justify-between rounded-lg bg-brass/10 px-3 py-2">
                <p className="text-[12px] text-zinc-400">
                  Registering for <span className="font-semibold text-pos-text">{tenantName}</span>
                </p>
                <button
                  type="button"
                  onClick={backToLogin}
                  className="flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-brass"
                >
                  <ArrowLeft className="size-3" />
                  Not you?
                </button>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-pos-text-2">Branch</span>
                <Select
                  value={selectedBranch}
                  onChange={setSelectedBranch}
                  placeholder="Select branch location..."
                  options={branches.map((b) => ({ value: b.id, label: b.name }))}
                  className="w-full"
                  size="md"
                />
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-pos-text-2">Terminal Name</span>
                <div className="relative">
                  <Tag className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
                  <input
                    autoFocus
                    type="text"
                    required
                    value={deviceName}
                    onChange={(e) => setDeviceName(e.target.value)}
                    className="field pl-9"
                    placeholder="e.g. Counter 1"
                  />
                </div>
              </label>
              <button
                type="submit"
                disabled={loading || !selectedBranch || !deviceName.trim()}
                className="btn-primary mt-2 flex justify-center py-2.5"
              >
                {loading ? <Loader2 className="size-5 animate-spin" /> : "Register Device"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
