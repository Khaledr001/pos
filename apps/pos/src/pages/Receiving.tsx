import { useEffect, useState, useRef } from "react";
import { apiClient } from "../lib/api-client.js";
import { formatDistanceToNow } from "date-fns";
import { ClipboardCheck, ScanBarcode, ChevronLeft, PackageCheck, AlertCircle } from "lucide-react";
import { useAuth } from "../store/auth.js";
import { quantity as fmtQuantity } from "../lib/money.js";

interface PurchaseOrder {
  id: string;
  poNumber: string;
  status: "draft" | "sent" | "partial" | "received" | "cancelled";
  supplierName: string;
  expectedDate: string | null;
  createdAt: string;
}

interface PurchaseOrderItem {
  id: string;
  variantId: string;
  productName: string;
  productSku: string;
  quantity: string;
  receivedQuantity: string;
  unitPrice: string;
  unitAbbr: string;
}

interface PurchaseOrderDetails {
  id: string;
  poNumber: string;
  supplierId: string;
  branchId: string;
  items: PurchaseOrderItem[];
}

export function Receiving() {
  const terminal = useAuth((s) => s.terminal);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrderDetails | null>(null);

  useEffect(() => {
    if (!terminal?.branchId) return;
    
    // We fetch "sent" and "partial" orders
    Promise.all([
      apiClient.get<{ items: PurchaseOrder[] }>(`/purchases?branchId=${terminal.branchId}&status=sent`),
      apiClient.get<{ items: PurchaseOrder[] }>(`/purchases?branchId=${terminal.branchId}&status=partial`)
    ])
      .then(([sentRes, partialRes]) => {
        setOrders([...sentRes.items, ...partialRes.items]);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [terminal?.branchId, selectedOrder]); // Refetch when returning to list

  async function handleSelect(id: string) {
    try {
      const res = await apiClient.get<PurchaseOrderDetails>(`/purchases/${id}`);
      setSelectedOrder(res);
    } catch (e: any) {
      alert(e.message || "Failed to load order details");
    }
  }

  return (
    <div className="flex h-screen flex-col bg-steel-900 overflow-hidden">
      <header className="flex h-[4.5rem] shrink-0 items-center border-b border-steel-800 bg-steel-900/95 px-6">
        {selectedOrder ? (
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setSelectedOrder(null)}
              className="p-2 -ml-2 rounded-lg hover:bg-steel-800 text-zinc-400 hover:text-white transition-colors"
            >
              <ChevronLeft className="size-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-3">
                Receive PO: {selectedOrder.poNumber}
              </h1>
              <p className="text-[13px] text-zinc-400">Scan barcodes to receive goods</p>
            </div>
          </div>
        ) : (
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">Purchase Receiving</h1>
            <p className="text-[13px] text-zinc-400">Select an expected delivery to receive goods</p>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-5xl mx-auto space-y-8">
          
          {!selectedOrder ? (
            <section>
              {loading ? (
                <div className="p-12 text-center text-zinc-500">Loading deliveries...</div>
              ) : orders.length > 0 ? (
                <div className="grid gap-4">
                  {orders.map((o) => (
                    <button 
                      key={o.id} 
                      onClick={() => handleSelect(o.id)}
                      className="bg-steel-800 border border-steel-700 hover:border-brass/50 rounded-lg p-5 flex items-center justify-between text-left transition-colors"
                    >
                      <div>
                        <div className="flex items-center gap-3 mb-1">
                          <span className="font-mono text-sm text-chalk">{o.poNumber}</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                            o.status === "partial" ? "bg-brass/20 text-brass" : "bg-blue-500/20 text-blue-400"
                          }`}>
                            {o.status}
                          </span>
                        </div>
                        <p className="text-[15px] font-medium text-white">
                          From: {o.supplierName}
                        </p>
                        <p className="text-[13px] text-zinc-500 mt-1">
                          Sent {formatDistanceToNow(new Date(o.createdAt))} ago
                        </p>
                      </div>
                      
                      <div className="text-brass">
                        <ClipboardCheck className="size-5" />
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="bg-steel-800/50 border border-steel-800 border-dashed rounded-lg p-12 text-center flex flex-col items-center justify-center">
                  <PackageCheck className="size-12 text-zinc-600 mb-4" />
                  <h3 className="text-white font-medium mb-1">No expected deliveries</h3>
                  <p className="text-zinc-500 text-sm">All purchase orders have been fully received.</p>
                </div>
              )}
            </section>
          ) : (
            <ReceivingForm order={selectedOrder} onComplete={() => setSelectedOrder(null)} />
          )}

        </div>
      </div>
    </div>
  );
}

function ReceivingForm({ order, onComplete }: { order: PurchaseOrderDetails, onComplete: () => void }) {
  const [scanned, setScanned] = useState<Record<string, number>>({});
  const [barcode, setBarcode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus barcode input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleScan(e: React.FormEvent) {
    e.preventDefault();
    if (!barcode.trim()) return;

    // We assume the barcode matches the SKU for this simple implementation
    // A more robust implementation would fetch the variant by barcode and match its ID
    const line = order.items.find(i => i.productSku.toLowerCase() === barcode.trim().toLowerCase());
    
    if (line) {
      const remaining = Number(line.quantity) - Number(line.receivedQuantity);
      const current = scanned[line.id] || 0;
      
      if (current >= remaining) {
        setError(`You have already scanned all expected units for ${line.productName}`);
      } else {
        setScanned(prev => ({ ...prev, [line.id]: current + 1 }));
        setError(null);
      }
    } else {
      setError(`Barcode ${barcode} not found in this Purchase Order.`);
    }
    
    setBarcode("");
    inputRef.current?.focus();
  }

  function setQuantity(lineId: string, q: number) {
    const line = order.items.find(i => i.id === lineId)!;
    const remaining = Number(line.quantity) - Number(line.receivedQuantity);
    const validQ = Math.max(0, Math.min(q, remaining));
    
    setScanned(prev => {
      const next = { ...prev };
      if (validQ === 0) delete next[lineId];
      else next[lineId] = validQ;
      return next;
    });
  }

  async function handleSubmit() {
    const lines = Object.entries(scanned).map(([lineId, qty]) => {
      const line = order.items.find(i => i.id === lineId)!;
      return {
        purchaseOrderItemId: line.id,
        variantId: line.variantId,
        quantity: qty,
        unitPrice: Number(line.unitPrice), // fallback to PO price
      };
    });

    if (lines.length === 0) {
      setError("You must receive at least one item before submitting.");
      return;
    }

    setSubmitting(true);
    try {
      await apiClient.post("/purchases/receive", {
        branchId: order.branchId,
        purchaseOrderId: order.id,
        supplierId: order.supplierId,
        lines,
      });
      onComplete();
    } catch (e: any) {
      setError(e.message || "Failed to submit receipt");
      setSubmitting(false);
    }
  }

  const hasItemsToReceive = order.items.some(i => Number(i.quantity) > Number(i.receivedQuantity));
  const totalScanned = Object.values(scanned).reduce((sum, q) => sum + q, 0);

  return (
    <div className="space-y-6">
      
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-signal-red/40 bg-signal-red/10 px-3 py-2.5 text-[13px] text-signal-red">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}

      {hasItemsToReceive ? (
        <form onSubmit={handleScan} className="flex gap-4">
          <div className="relative flex-1">
            <ScanBarcode className="absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-zinc-500" />
            <input
              ref={inputRef}
              value={barcode}
              onChange={e => setBarcode(e.target.value)}
              className="w-full rounded-lg border border-steel-700 bg-steel-800 py-4 pl-12 pr-4 text-lg text-white placeholder:text-zinc-500 focus:border-brass focus:outline-none"
              placeholder="Scan barcode or type SKU..."
              autoFocus
            />
          </div>
          <button type="submit" className="btn btn-secondary px-8">
            Add
          </button>
        </form>
      ) : (
        <div className="rounded-lg border border-signal-green/40 bg-signal-green/10 px-4 py-3 text-signal-green flex items-center gap-3">
          <CheckCircle2 className="size-5" />
          <p className="font-medium">This order has been fully received.</p>
        </div>
      )}

      <div className="bg-steel-800 border border-steel-700 rounded-lg overflow-hidden">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-steel-900 text-zinc-400">
            <tr>
              <th className="px-4 py-3 font-medium">Product</th>
              <th className="px-4 py-3 font-medium text-right">Expected</th>
              <th className="px-4 py-3 font-medium text-right">Previously Received</th>
              <th className="px-4 py-3 font-medium text-right">Receiving Now</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-steel-700/50">
            {order.items.map(item => {
              const expected = Number(item.quantity);
              const prevReceived = Number(item.receivedQuantity);
              const remaining = expected - prevReceived;
              const currentlyScanned = scanned[item.id] || 0;
              const isFullyReceived = prevReceived >= expected;
              
              return (
                <tr key={item.id} className={isFullyReceived ? "opacity-50" : ""}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{item.productName}</div>
                    <div className="text-zinc-500 text-[11px] mt-0.5">{item.productSku}</div>
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-300 num">
                    {fmtQuantity(expected)} <span className="text-[10px] text-zinc-500">{item.unitAbbr}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-300 num">
                    {fmtQuantity(prevReceived)} <span className="text-[10px] text-zinc-500">{item.unitAbbr}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!isFullyReceived ? (
                      <div className="flex items-center justify-end gap-2">
                        <input
                          type="number"
                          min="0"
                          max={remaining}
                          value={currentlyScanned || ""}
                          onChange={(e) => setQuantity(item.id, parseInt(e.target.value) || 0)}
                          className={`w-16 rounded border ${currentlyScanned > 0 ? "border-brass bg-brass/10 text-brass font-bold" : "border-steel-600 bg-steel-900 text-white"} px-2 py-1 text-center num focus:border-brass focus:outline-none`}
                          placeholder="0"
                        />
                      </div>
                    ) : (
                      <span className="text-signal-green font-medium flex items-center justify-end gap-1">
                        <CheckCircle2 className="size-3" /> Complete
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end pt-4 border-t border-steel-800">
        <button
          type="button"
          disabled={submitting || totalScanned === 0}
          onClick={handleSubmit}
          className="btn btn-primary px-8 py-3"
        >
          {submitting ? "Submitting..." : `Submit Receipt (${totalScanned} items)`}
        </button>
      </div>

    </div>
  );
}

// Ensure CheckCircle2 is imported if used
import { CheckCircle2 } from "lucide-react";
