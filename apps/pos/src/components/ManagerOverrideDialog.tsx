import type { Permission } from "@devsfleet/shared-types";
import { useState } from "react";
import React from "react";
import { posData } from "../lib/pos-data.js";
import { Dialog } from "./Dialog.js";
import { Keypad } from "./Keypad.js";
import { AlertCircle, ShieldCheck } from "lucide-react";

export function ManagerOverrideDialog({
  open,
  requiredPermission,
  onClose,
  onSuccess,
}: {
  open: boolean;
  requiredPermission: Permission;
  onClose: () => void;
  onSuccess: (managerName: string, grant: string) => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (pin.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      setError(null);
      const approval = await posData.managerOverride(pin, requiredPermission);
      setPin("");
      onSuccess(approval.managerName, approval.grant);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Invalid PIN, or that PIN cannot approve this action.",
      );
      setPin("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Manager Authorization Override" width="sm">
      <div className="space-y-4">
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-signal-red/30 bg-signal-red/10 p-3 text-xs text-signal-red font-medium">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        )}

        <div>
          <label className="eyebrow block mb-1">Enter Manager 4-Digit PIN</label>
          <input
            type="password"
            value={pin}
            readOnly
            className="field text-center tracking-[0.5em] text-2xl font-bold bg-(--pos-raised) border-(--pos-border) text-(--pos-text)"
            placeholder="••••"
          />
        </div>

        <Keypad
          onDigit={(d) => setPin((v) => v + d)}
          onBackspace={() => setPin((v) => v.slice(0, -1))}
          onClear={() => setPin("")}
        />

        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-ghost flex-1 text-xs"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary flex-1 text-xs font-bold"
            disabled={pin.length === 0 || submitting}
            onClick={() => void handleSubmit()}
          >
            <ShieldCheck className="size-3.5 mr-1" />
            {submitting ? "Verifying…" : "Authorize"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
