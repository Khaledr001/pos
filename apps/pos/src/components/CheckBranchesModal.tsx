import { Dialog } from "./Dialog.js";
import { useEffect, useState } from "react";
import { posData, type PosProduct } from "../lib/pos-data.js";
import { Building2, Search, AlertCircle } from "lucide-react";
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
        // Filter out current branch if needed, but the API doesn't know the current branch easily here
        // We'll just show all branches
        setBranches(data);
        setLoading(false);
      })
      .catch(() => {
        setError("Could not connect to the server to check other branches. Are you offline?");
        setLoading(false);
      });
  }, [open, product]);

  return (
    <Dialog open={open} onClose={onClose} title="Stock in Other Branches" width="md">
      <div className="space-y-4">
        {product && (
          <div className="rounded-lg bg-steel-800 p-4 mb-4">
            <div className="font-semibold text-white text-lg">{product.name}</div>
            <div className="text-zinc-400 text-sm mt-1">{product.sku}</div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-signal-red/40 bg-signal-red/10 px-3 py-2.5 text-[13px] text-signal-red">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        )}

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center text-zinc-500">
            <Search className="size-8 animate-pulse mb-3 opacity-50" />
            <p>Searching all branches...</p>
          </div>
        ) : branches.length > 0 ? (
          <div className="divide-y divide-steel-800 border border-steel-800 rounded-lg overflow-hidden">
            {branches.map((b, i) => (
              <div key={i} className="flex justify-between items-center p-4 bg-steel-900">
                <div className="flex items-center gap-3">
                  <Building2 className="size-5 text-zinc-400" />
                  <span className="font-medium text-white">{b.branchName}</span>
                </div>
                <div className="text-right">
                  <span className="text-lg font-semibold num text-white">
                    {fmtQuantity(b.available)}
                  </span>
                  <span className="text-zinc-500 ml-1.5 text-xs">{product?.unitAbbr}</span>
                </div>
              </div>
            ))}
          </div>
        ) : !error ? (
          <div className="py-12 text-center text-zinc-500">
            <Building2 className="size-12 mx-auto mb-3 opacity-20" />
            <p>No stock found in any other branches.</p>
          </div>
        ) : null}

        <div className="pt-4 text-right">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Dialog>
  );
}
