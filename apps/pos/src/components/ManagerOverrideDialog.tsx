import type { Permission } from "@devsfleet/shared-types";
import { useState } from "react";
import { posData } from "../lib/pos-data.js";
import { Dialog } from "./Dialog.js";
import { Keypad } from "./Keypad.js";
import { AlertCircle } from "lucide-react";

export function ManagerOverrideDialog({
  open,
  requiredPermission,
  onClose,
  onSuccess,
}: {
  open: boolean;
  requiredPermission: Permission;
  onClose: () => void;
  /**
   * The grant is the half that matters.
   *
   * A name is for the receipt; the grant is what the server checks when the
   * sale finally reaches it — possibly hours later, on the cashier's session,
   * long after this dialog closed. A caller that ignores it has collected an
   * approval nobody downstream will ever see.
   */
  onSuccess: (managerName: string, grant: string) => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (pin.length === 0) return;
    try {
      setError(null);
      const approval = await posData.managerOverride(pin, requiredPermission);
      setPin("");
      onSuccess(approval.managerName, approval.grant);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Invalid PIN, or that PIN cannot approve this.",
      );
      setPin("");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Manager Override" width="sm">
      <div className="space-y-4">
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-signal-red/40 bg-signal-red/10 px-3 py-2.5 text-[13px] text-signal-red">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        )}
        <div>
          <label className="eyebrow block">Manager PIN</label>
          <input
            type="password"
            value={pin}
            readOnly
            className="field mt-1.5 text-center tracking-[0.5em] text-xl font-semibold"
          />
        </div>
        <Keypad
          onDigit={(d) => setPin((v) => v + d)}
          onBackspace={() => setPin((v) => v.slice(0, -1))}
          onClear={() => setPin("")}
        />
        <button
          type="button"
          className="btn btn-primary w-full"
          disabled={pin.length === 0}
          onClick={() => void handleSubmit()}
        >
          Confirm
        </button>
      </div>
    </Dialog>
  );
}
