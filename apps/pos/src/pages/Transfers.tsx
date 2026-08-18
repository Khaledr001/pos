import { useEffect, useState } from "react";
import { apiClient } from "../lib/api-client.js";
import { formatDistanceToNow } from "date-fns";
import { PackageOpen, ArrowRightLeft, Plus, CheckCircle2, Truck } from "lucide-react";
import { useAuth } from "../store/auth.js";
import { RequestTransferModal } from "./RequestTransferModal.js";

interface TransferItem {
  variantId: string;
  sku: string;
  productName: string;
  quantity: string;
}

interface Transfer {
  id: string;
  transferNumber: string;
  fromBranchId: string;
  toBranchId: string;
  status: "requested" | "approved" | "shipped" | "received" | "cancelled";
  createdAt: string;
  notes: string | null;
  items: TransferItem[];
}

export function Transfers() {
  const terminal = useAuth((s) => s.terminal);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [requestModalOpen, setRequestModalOpen] = useState(false);

  function loadTransfers() {
    if (!terminal?.branchId) return;
    setLoading(true);
    apiClient
      .get<{ data: Transfer[] }>(`/transfers?branchId=${terminal.branchId}`)
      .then((res) => {
        setTransfers(res.data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }

  useEffect(() => {
    loadTransfers();
  }, [terminal?.branchId]);

  async function handleReceive(id: string) {
    if (!confirm("Are you sure you want to receive this stock?")) return;
    try {
      await apiClient.post(`/transfers/${id}/receive`);
      setTransfers((prev) => prev.map(t => t.id === id ? { ...t, status: "received" } : t));
    } catch (e: any) {
      alert(e.message || "Failed to receive transfer");
    }
  }

  const incoming = transfers.filter(t => t.toBranchId === terminal?.branchId && t.status !== "received" && t.status !== "cancelled");
  
  return (
    <div className="flex h-screen flex-col bg-steel-900 overflow-hidden">
      <header className="flex h-[4.5rem] shrink-0 items-center justify-between border-b border-steel-800 bg-steel-900/95 px-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Stock Transfers</h1>
          <p className="text-[13px] text-zinc-400">Manage incoming and outgoing inventory</p>
        </div>
        <button 
          type="button" 
          className="btn btn-primary"
          onClick={() => setRequestModalOpen(true)}
        >
          <Plus className="size-4 mr-2" /> Request Stock
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-5xl mx-auto space-y-8">
          
          <section>
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <ArrowRightLeft className="size-4 text-brass" /> Incoming & Actionable
            </h2>
            
            {loading ? (
              <div className="p-12 text-center text-zinc-500">Loading transfers...</div>
            ) : incoming.length > 0 ? (
              <div className="grid gap-4">
                {incoming.map((t) => (
                  <div key={t.id} className="bg-steel-800 border border-steel-700 rounded-lg p-5 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <span className="font-mono text-sm text-chalk">{t.transferNumber}</span>
                        <StatusBadge status={t.status} />
                      </div>
                      <p className="text-[13px] text-zinc-400">
                        Requested {formatDistanceToNow(new Date(t.createdAt))} ago
                      </p>
                      
                      <div className="mt-4 space-y-1">
                        {t.items.map((item, idx) => (
                          <div key={idx} className="text-sm">
                            <span className="font-semibold text-white">{item.quantity}x</span> {item.productName} <span className="text-zinc-500 text-xs ml-2">({item.sku})</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    <div>
                      {t.status === "shipped" && (
                        <button 
                          onClick={() => handleReceive(t.id)}
                          className="btn bg-signal-green text-steel-950 hover:bg-signal-green/90"
                        >
                          <CheckCircle2 className="size-4 mr-2" /> Receive Goods
                        </button>
                      )}
                      {t.status === "requested" && (
                        <span className="text-sm text-zinc-500 italic">Waiting for approval</span>
                      )}
                      {t.status === "approved" && (
                        <span className="text-sm text-zinc-500 italic">Waiting for source branch to ship</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-steel-800/50 border border-steel-800 border-dashed rounded-lg p-12 text-center flex flex-col items-center justify-center">
                <PackageOpen className="size-12 text-zinc-600 mb-4" />
                <h3 className="text-white font-medium mb-1">No pending transfers</h3>
                <p className="text-zinc-500 text-sm">You have no incoming shipments to receive right now.</p>
              </div>
            )}
          </section>

        </div>
      </div>
      
      {requestModalOpen && (
        <RequestTransferModal
          open={requestModalOpen}
          onClose={() => setRequestModalOpen(false)}
          onSuccess={() => {
            setRequestModalOpen(false);
            loadTransfers();
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "requested") return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-500/20 text-zinc-400">REQUESTED</span>;
  if (status === "approved") return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-500/20 text-blue-400">APPROVED</span>;
  if (status === "shipped") return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-brass/20 text-brass flex items-center gap-1"><Truck className="size-3" /> SHIPPED</span>;
  if (status === "received") return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-signal-green/20 text-signal-green">RECEIVED</span>;
  return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-500/20 text-zinc-400">{status.toUpperCase()}</span>;
}
