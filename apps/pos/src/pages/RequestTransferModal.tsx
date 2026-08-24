import { useState, useEffect } from "react";
import React from "react";
import { hasBridge, posData, type PosProduct } from "../lib/pos-data.js";
import { Dialog } from "../components/Dialog.js";
import { Select } from "../components/Select.js";
import { Building2, Search, Package, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../store/auth.js";

export function RequestTransferModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const terminal = useAuth((s) => s.terminal);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PosProduct[]>([]);
  
  const [items, setItems] = useState<Array<{ variantId: string; product: PosProduct; quantity: number }>>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !hasBridge()) return;
    window.devsfleet.transfers
      .branches()
      .then((res) => {
        setBranches((res.data ?? []).filter((b) => b.id !== terminal?.branchId));
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Could not load the list of branches.");
      });
  }, [open, terminal?.branchId]);

  useEffect(() => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      posData.searchProducts(query).then((res) => setSearchResults(res ?? []));
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  function addItem(product: PosProduct) {
    if (items.some((i) => i.variantId === product.id)) return;
    setItems([...items, { variantId: product.id, product, quantity: 1 }]);
    setQuery("");
  }

  function updateQuantity(variantId: string, q: number) {
    if (q <= 0) {
      setItems(items.filter((i) => i.variantId !== variantId));
    } else {
      setItems(items.map((i) => (i.variantId === variantId ? { ...i, quantity: q } : i)));
    }
  }

  async function handleSubmit() {
    if (!selectedBranch || items.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await window.devsfleet.transfers.request({
        fromBranchId: selectedBranch,
        items: items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
        ...(notes ? { notes } : {}),
      });
      onSuccess();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to submit the transfer request.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Request Stock Transfer" width="lg">
      <div className="grid gap-6 sm:grid-cols-[1fr_1.5fr]">
        {/* Left Side: Form */}
        <div className="space-y-4">
          <div>
            <label className="eyebrow block mb-1">Source Branch</label>
            <Select
              value={selectedBranch}
              onChange={setSelectedBranch}
              placeholder="Select source branch..."
              options={branches.map((b) => ({ value: b.id, label: b.name, icon: Building2 }))}
              className="w-full"
              size="md"
            />
          </div>

          <div>
            <label className="eyebrow block mb-1">Notes (Optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="field text-xs w-full bg-[var(--pos-raised)] border-[var(--pos-border)] text-[var(--pos-text)]"
              rows={3}
              placeholder="e.g. Urgent customer order"
            />
          </div>

          <div className="pt-2">
            {error && (
              <p className="mb-2 rounded-xl border border-signal-red/30 bg-signal-red/10 p-2.5 text-xs text-signal-red font-medium">
                {error}
              </p>
            )}
            <button
              type="button"
              className="btn btn-primary w-full text-xs font-bold justify-center"
              disabled={!selectedBranch || items.length === 0 || submitting}
              onClick={handleSubmit}
            >
              {submitting ? "Submitting…" : "Submit Transfer Request"}
            </button>
          </div>
        </div>

        {/* Right Side: Items Selection */}
        <div className="space-y-3 flex flex-col h-[380px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--pos-text-3)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="field pl-9.5 text-xs w-full bg-[var(--pos-raised)] border-[var(--pos-border)] text-[var(--pos-text)]"
              placeholder="Search products to request…"
            />

            {query && searchResults.length > 0 && (
              <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-[var(--pos-border)] bg-[var(--pos-panel)] p-1 shadow-xl scrollbar-thin">
                {searchResults.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => addItem(p)}
                      className="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-[var(--pos-raised)] flex items-center justify-between text-[var(--pos-text)] cursor-pointer"
                    >
                      <span className="font-semibold truncate">{p.name}</span>
                      <span className="font-mono text-[10px] text-[var(--pos-text-3)] ml-2 shrink-0">{p.sku}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex-1 overflow-y-auto border border-[var(--pos-border)] bg-[var(--pos-raised)]/40 rounded-xl p-2.5 scrollbar-thin">
            {items.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-[var(--pos-text-3)]">
                <Package className="size-8 opacity-20 mb-2" />
                <p className="text-xs">Search and add items to this transfer</p>
              </div>
            ) : (
              <ul className="space-y-1.5">
                {items.map((item) => (
                  <li
                    key={item.variantId}
                    className="flex items-center justify-between bg-[var(--pos-panel)] border border-[var(--pos-border)] p-2.5 rounded-xl"
                  >
                    <div className="min-w-0 flex-1 mr-2">
                      <div className="truncate text-xs font-bold text-[var(--pos-text)]">
                        {item.product.name}
                      </div>
                      <div className="font-mono text-[10px] text-[var(--pos-text-3)]">{item.product.sku}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => updateQuantity(item.variantId, parseInt(e.target.value) || 0)}
                        className="w-14 rounded-lg border border-[var(--pos-border)] bg-[var(--pos-raised)] px-2 py-1 text-center font-mono font-bold text-xs text-[var(--pos-text)] focus:outline-none"
                      />
                      <span className="text-[10px] text-[var(--pos-text-3)] w-8">{item.product.unitAbbr}</span>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.variantId, 0)}
                        className="rounded p-1 text-[var(--pos-text-3)] hover:text-signal-red hover:bg-signal-red/10"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
