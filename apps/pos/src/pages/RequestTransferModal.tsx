import { useState, useEffect } from "react";
import { apiClient } from "../lib/api-client.js";
import { posData, type PosProduct } from "../lib/pos-data.js";
import { Dialog } from "../components/Dialog.js";
import { Building2, Search, Package, Plus } from "lucide-react";
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

  useEffect(() => {
    if (!open) return;
    // We already have a /branches endpoint for registration we can use
    apiClient.get<{ data: Array<{ id: string; name: string }> }>("/branches")
      .then(res => {
        setBranches(res.data.filter(b => b.id !== terminal?.branchId));
      })
      .catch(console.error);
  }, [open, terminal?.branchId]);

  useEffect(() => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      posData.searchProducts(query).then(setSearchResults);
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  function addItem(product: PosProduct) {
    if (items.some(i => i.variantId === product.id)) return;
    setItems([...items, { variantId: product.id, product, quantity: 1 }]);
    setQuery("");
  }

  function updateQuantity(variantId: string, q: number) {
    if (q <= 0) {
      setItems(items.filter(i => i.variantId !== variantId));
    } else {
      setItems(items.map(i => i.variantId === variantId ? { ...i, quantity: q } : i));
    }
  }

  async function handleSubmit() {
    if (!selectedBranch || items.length === 0) return;
    setSubmitting(true);
    try {
      await apiClient.post("/transfers", {
        fromBranchId: selectedBranch, // We are requesting FROM them
        toBranchId: terminal?.branchId, // TO us
        items: items.map(i => ({ variantId: i.variantId, quantity: i.quantity })),
        notes: notes || undefined,
      });
      onSuccess();
    } catch (e: any) {
      alert(e.message || "Failed to submit transfer request");
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
            <label className="eyebrow block">Request From Branch</label>
            <div className="relative mt-1.5">
              <Building2 className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
              <select
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
                className="w-full rounded-lg border border-steel-700 bg-steel-800 py-2.5 pl-10 pr-4 text-[13px] text-white focus:border-brass focus:outline-none"
              >
                <option value="" disabled>Select source branch...</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="eyebrow block">Notes (Optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-steel-700 bg-steel-800 py-2.5 px-3 text-[13px] text-white mt-1.5 focus:border-brass focus:outline-none"
              rows={3}
              placeholder="e.g. Urgent request for weekend sale"
            />
          </div>

          <div className="pt-2">
            <button
              type="button"
              className="btn btn-primary w-full"
              disabled={!selectedBranch || items.length === 0 || submitting}
              onClick={handleSubmit}
            >
              {submitting ? "Submitting..." : "Submit Request"}
            </button>
          </div>
        </div>

        {/* Right Side: Items */}
        <div className="space-y-4 flex flex-col h-[400px]">
          <div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded-lg border border-steel-700 bg-steel-800 py-2 pl-10 pr-4 text-[13px] text-white focus:border-brass focus:outline-none"
                placeholder="Search products to request..."
              />
            </div>
            
            {query && searchResults.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-48 w-64 overflow-y-auto rounded-lg border border-steel-700 bg-steel-900 shadow-xl">
                {searchResults.map(p => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => addItem(p)}
                      className="w-full text-left px-3 py-2 text-[12px] hover:bg-steel-800 flex justify-between"
                    >
                      <span className="truncate">{p.name}</span>
                      <span className="text-zinc-500">{p.sku}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex-1 overflow-y-auto border border-steel-700 bg-steel-900 rounded-lg p-2">
            {items.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-zinc-500">
                <Package className="size-8 opacity-20 mb-2" />
                <p className="text-[12px]">Search and add products to request</p>
              </div>
            ) : (
              <ul className="space-y-1">
                {items.map(item => (
                  <li key={item.variantId} className="flex items-center justify-between bg-steel-800 p-2 rounded">
                    <div className="min-w-0 flex-1 mr-2">
                      <div className="truncate text-[12px] font-medium text-white">{item.product.name}</div>
                      <div className="text-[10px] text-zinc-500">{item.product.sku}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        value={item.quantity}
                        onChange={(e) => updateQuantity(item.variantId, parseInt(e.target.value) || 0)}
                        className="w-16 rounded border border-steel-700 bg-steel-900 px-2 py-1 text-center text-[12px] text-white focus:border-brass focus:outline-none"
                      />
                      <span className="text-[10px] text-zinc-500 w-6">{item.product.unitAbbr}</span>
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
