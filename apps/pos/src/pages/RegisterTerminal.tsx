import { Loader2, MonitorSmartphone } from "lucide-react";
import { useState } from "react";
import { clearApiTokens } from "../lib/api-client.js";
import {
  adminLoginForRegistration,
  fetchBranchesForRegistration,
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
      if (branchList.length > 0) setSelectedBranch(branchList[0].id);
      
      setStep("details");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid credentials");
      clearApiTokens(); // Remove broken/partial tokens
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedBranch || !deviceName.trim()) return;
    
    setLoading(true);
    setError(null);
    try {
      const device = await registerDeviceOnServer(selectedBranch, deviceName.trim());
      const branchName = branches.find((b) => b.id === selectedBranch)?.name ?? "";

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
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-steel-900 p-6 text-pos-text">
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
                <input
                  autoFocus
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input"
                  placeholder="admin@example.com"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-pos-text-2">Password</span>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input"
                />
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
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-pos-text-2">Branch</span>
                <select
                  required
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  className="input appearance-none bg-pos-raised"
                >
                  <option value="" disabled>Select a branch</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-pos-text-2">Terminal Name</span>
                <input
                  autoFocus
                  type="text"
                  required
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  className="input"
                  placeholder="e.g. Counter 1"
                />
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
