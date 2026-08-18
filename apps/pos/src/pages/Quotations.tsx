import { Money } from "@devsfleet/shared-utils";
import { FileText, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { money, quantity as fmtQuantity } from "../lib/money.js";
import { posData, type PosQuotationReceipt, type PosCustomer } from "../lib/pos-data.js";
import { useAuth } from "../store/auth.js";
import { useCart } from "../store/cart.js";
import { useNavigate } from "react-router-dom";

export function Quotations() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [quotations, setQuotations] = useState<PosQuotationReceipt[]>([]);
  const [customers, setCustomers] = useState<Record<string, PosCustomer>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function load() {
      const list = (await posData.listQuotations()) as PosQuotationReceipt[];
      setQuotations(list);

      // Preload customers to show names instead of IDs
      const allCustomers = await posData.searchCustomers("");
      const cmap: Record<string, PosCustomer> = {};
      allCustomers.forEach((c) => {
        cmap[c.id] = c;
      });
      setCustomers(cmap);
    }
    void load();
  }, []);

  async function convertToSale(q: PosQuotationReceipt) {
    if (busy) return;
    setBusy(true);
    try {
      const cart = useCart.getState();
      cart.clear();

      const customer = customers[q.customerId ?? ""];
      if (customer) {
        cart.setCustomer(customer);
      }

      // We reconstruct the products by searching the catalog so we have the full PosProduct
      for (const line of q.lines) {
        const foundProducts = await posData.searchProducts(line.productSku);
        const product = foundProducts.find((p) => p.id === line.variantId);
        
        if (product) {
          cart.addProduct(product, line.quantity);
          // Set the exact price/discount from the quotation
          const key = cart.lines[cart.lines.length - 1]?.key;
          if (key) {
            cart.setUnitPrice(key, line.unitPrice, true);
            cart.setLineDiscount(key, line.discountPercent);
          }
        }
      }
      
      // Navigate to the sale screen to complete checkout
      navigate("/");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-[20px] font-semibold text-steel-100">Quotations</h1>
          <p className="text-[14px] text-steel-400">Draft proposals awaiting customer approval</p>
        </div>

        {quotations.length === 0 ? (
          <div className="rounded-lg border border-steel-800 bg-steel-900 px-6 py-12 text-center">
            <FileText className="mx-auto size-12 text-steel-600" aria-hidden />
            <p className="mt-4 text-[15px] font-medium text-steel-300">No quotations found</p>
            <p className="mt-1 text-[13px] text-steel-500">
              Build a cart on the Sale screen and press F7 to save it as a quotation.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {quotations.map((q) => {
              const customerName = customers[q.customerId ?? ""]?.name ?? "Unknown Customer";
              return (
                <div
                  key={q.localId}
                  className="flex flex-col gap-4 rounded-xl border border-steel-700 bg-steel-850 p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="font-medium text-steel-100">{customerName}</h2>
                      <div className="mt-1 flex items-center gap-2 text-[12px] text-steel-400">
                        <span>{new Date(q.occurredAt).toLocaleDateString()}</span>
                        <span aria-hidden>·</span>
                        <span className="font-mono">{q.quotationNumber || "Pending Sync"}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-[16px] font-semibold text-brass-400">
                        {money(Money.toMinor(q.total))}
                      </div>
                      <div className="text-[12px] text-steel-500">
                        {q.lines.length} {q.lines.length === 1 ? "item" : "items"}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 border-t border-steel-700/50 pt-4">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void convertToSale(q)}
                      className="flex-1 rounded-lg bg-brass-500 px-3 py-2 text-[13px] font-medium text-steel-950 transition hover:bg-brass-400 disabled:opacity-50"
                    >
                      Convert to Sale
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
