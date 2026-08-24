import { Dialog } from "./Dialog.js";
import React, { useEffect, useState } from "react";
import { posData, type PosProduct } from "../lib/pos-data.js";
import { Building2, Search, AlertCircle, Loader2 } from "lucide-react";
import { quantity as fmtQuantity } from "../lib/money.js";

export function CheckBranchesModal({
  product,
  open,
  onClose,
}: {
  product: PosProduct | null;
  open: boolean;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<Array<{ branchName: string; available: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !product) {
      setBranches([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    posData.checkStockInOtherBranches(product.sku)
      .then((data) => {
        setBranches(data ?? []);
        setLoading(false);
      })
      .catch(() => {
        setError("Could not connect to the central server to check other branches. Are you offline?");
        setLoading(false);
      });
  }, [open, product]);

  return (
    <Dialog open={open} onClose={onClose} title="Stock in Other Branches" width="md">
      <div className="space-y-4">
        {product && (
          <div className="rounded-xl border border-[var(--pos-border)] bg-[var(--pos-raised)] p-3.5">
            <div className="font-bold text-[var(--pos-text)] text-sm">{product.name}</div>
            <div className="text-[var(--pos-text-3)] font-mono text-xs mt-0.5">SKU: {product.sku}</div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-signal-red/30 bg-signal-red/10 p-3 text-xs text-signal-red font-medium">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        )}

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center text-[var(--pos-text-3)]">
            <Loader2 className="size-8 animate-spin mb-3 text-[var(--pos-accent)]" />
            <p className="text-xs font-medium">Searching branch stock balances…</p>
          </div>
        ) : branches.length > 0 ? (
          <div className="divide-y divide-[var(--pos-border)] border border-[var(--pos-border)] rounded-xl overflow-hidden bg-[var(--pos-panel)]">
            {branches.map((b, i) => (
              <div key={i} className="flex justify-between items-center p-3.5 hover:bg-[var(--pos-raised)]/50 transition-colors">
                <div className="flex items-center gap-2.5">
                  <Building2 className="size-4 text-[var(--pos-accent)]" />
                  <span className="font-semibold text-xs text-[var(--pos-text)]">{b.branchName}</span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-bold num font-mono text-[var(--pos-text)]">
                    {fmtQuantity(b.available)}
                  </span>
                  <span className="text-[var(--pos-text-3)] ml-1 text-xs">{product?.unitAbbr}</span>
                </div>
              </div>
            ))}
          </div>
        ) : !error ? (
          <div className="py-10 text-center text-[var(--pos-text-3)]">
            <Building2 className="size-10 mx-auto mb-2 opacity-30 text-[var(--pos-text-3)]" />
            <p className="text-xs font-semibold text-[var(--pos-text)]">No stock found in other branches</p>
            <p className="text-[11px] text-[var(--pos-text-3)] mt-0.5">This item is currently out of stock across all locations.</p>
          </div>
        ) : null}

        <div className="pt-2 text-right">
          <button type="button" className="btn btn-ghost text-xs" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Dialog>
  );
}
