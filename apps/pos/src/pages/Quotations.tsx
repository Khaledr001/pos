import { Money } from "@devsfleet/shared-utils";
import {
  AlertCircle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  FileText,
  Loader2,
  Plus,
  Printer,
  Search,
  ShoppingCart,
  User,
  X,
} from "lucide-react";
import React, { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRail } from "../components/KeyRail.js";
import { money, quantity as fmtQuantity } from "../lib/money.js";
import {
  posData,
  type PosCustomer,
  type PosQuotationReceipt,
} from "../lib/pos-data.js";
import { useAuth } from "../store/auth.js";
import { useCart } from "../store/cart.js";

/**
 * POS Quotations Management Screen.
 *
 * Lets trade counter cashiers view, search, inspect line items, print,
 * and seamlessly convert saved quotations into active checkout carts.
 */
export function Quotations() {
  const { can } = useAuth();
  const navigate = useNavigate();

  const [quotations, setQuotations] = useState<PosQuotationReceipt[]>([]);
  const [customers, setCustomers] = useState<Record<string, PosCustomer>>({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [convertingId, setConvertingId] = useState<string | null>(null);

  // Selected quotation for line-item inspection modal
  const [selectedQuotation, setSelectedQuotation] = useState<PosQuotationReceipt | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const list = (await posData.listQuotations()) as PosQuotationReceipt[];
        setQuotations(list ?? []);

        // Preload customers for instant name & detail matching
        const allCustomers = await posData.searchCustomers("");
        const cmap: Record<string, PosCustomer> = {};
        (allCustomers ?? []).forEach((c) => {
          cmap[c.id] = c;
        });
        setCustomers(cmap);
      } catch (err) {
        console.error("Failed to load quotations:", err);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  // Filter quotations by search query (customer name, quote number, phone, or company)
  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return quotations;

    return quotations.filter((item) => {
      const customer = customers[item.customerId ?? ""];
      const custName = customer?.name?.toLowerCase() ?? "";
      const custPhone = customer?.phone?.toLowerCase() ?? "";
      const custCompany = customer?.company?.toLowerCase() ?? "";
      const quoteNum = (item.quotationNumber ?? item.localId).toLowerCase();

      return (
        custName.includes(q) ||
        custPhone.includes(q) ||
        custCompany.includes(q) ||
        quoteNum.includes(q)
      );
    });
  }, [quotations, customers, searchQuery]);

  async function convertToSale(q: PosQuotationReceipt) {
    if (convertingId) return;
    setConvertingId(q.localId);
    try {
      const cart = useCart.getState();
      cart.clear();

      const customer = customers[q.customerId ?? ""];
      if (customer) {
        cart.setCustomer(customer);
      }

      // Reconstruct products by searching catalog
      for (const line of q.lines) {
        const foundProducts = await posData.searchProducts(line.productSku);
        const product =
          foundProducts.find((p) => p.id === line.variantId) ??
          foundProducts[0];

        if (product) {
          cart.addProduct(product, line.quantity);

          /**
           * Quoted price is restored as quoted — but NOT excused from the floor
           * check unless this cashier has the permission to override it.
           */
          const key = cart.lines[cart.lines.length - 1]?.key;
          if (key) {
            cart.setUnitPrice(key, line.unitPrice, can("price:override_floor"));
            cart.setLineDiscount(key, line.discountPercent);
          }
        }
      }

      // Navigate to checkout sale screen
      navigate("/");
    } finally {
      setConvertingId(null);
    }
  }

  function printQuotationSlip(q: PosQuotationReceipt) {
    window.print();
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6 bg-(--pos-bg)">
        <div className="mx-auto max-w-5xl space-y-5">
          {/* ── Top Header Strip ── */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-(--pos-border) pb-4">
            <div>
              <h1 className="text-lg font-bold tracking-tight text-(--pos-text) flex items-center gap-2">
                <FileText className="size-5 text-(--pos-accent)" />
                Quotations & Estimates
              </h1>
              <p className="text-xs text-(--pos-text-3) mt-0.5">
                Draft proposals and proforma quotes ready to convert to counter sales
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-(--pos-raised) text-(--pos-text-2) border border-(--pos-border)">
                {quotations.length} {quotations.length === 1 ? "Quotation" : "Quotations"}
              </span>
              <button
                type="button"
                onClick={() => navigate("/")}
                className="btn btn-primary text-xs h-9 px-3.5"
              >
                <Plus className="size-3.5 mr-1" />
                New Quote (F7 on Sale)
              </button>
            </div>
          </div>

          {/* ── Search / Filter Bar ── */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-(--pos-text-3)" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search quotations by customer name, phone, company, or quote number..."
              className="field num pl-10 h-10 text-xs w-full bg-(--pos-panel) border-(--pos-border)"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-(--pos-text-3) hover:text-(--pos-text)"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* ── Quotations List / Cards Grid ── */}
          {loading ? (
            <div className="py-16 text-center text-(--pos-text-3)">
              <Loader2 className="size-8 animate-spin mx-auto mb-2 text-(--pos-accent)" />
              <p className="text-xs font-medium">Loading saved quotations…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-(--pos-border) bg-(--pos-panel) px-6 py-14 text-center shadow-xs">
              <FileText className="mx-auto size-12 text-(--pos-text-3)/50" />
              <p className="mt-3 text-sm font-bold text-(--pos-text)">
                {searchQuery ? `No quotations matching "${searchQuery}"` : "No quotations on this terminal"}
              </p>
              <p className="mt-1 text-xs text-(--pos-text-3) max-w-sm mx-auto">
                {searchQuery
                  ? "Try searching with a different term or clear the filter."
                  : "Build a cart on the Sale counter and press F7 to save it as a customer quotation."}
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {filtered.map((q) => {
                const customer = customers[q.customerId ?? ""];
                const customerName = customer?.name ?? "Walk-in Customer";
                const isConverting = convertingId === q.localId;

                return (
                  <div
                    key={q.localId}
                    className="flex flex-col justify-between rounded-2xl border border-(--pos-border) bg-(--pos-panel) p-4.5 shadow-xs hover:border-(--pos-accent)/50 transition-all"
                  >
                    <div>
                      {/* Card Header: Customer & Amount */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <User className="size-3.5 text-(--pos-accent) shrink-0" />
                            <h2 className="font-bold text-sm text-(--pos-text) truncate">
                              {customerName}
                            </h2>
                          </div>
                          {customer?.company && (
                            <p className="text-[11px] text-(--pos-text-3) truncate pl-5">
                              {customer.company}
                            </p>
                          )}
                        </div>

                        <div className="text-right shrink-0">
                          <div className="font-mono font-bold text-base text-(--pos-accent)">
                            AED {parseFloat(q.total).toFixed(2)}
                          </div>
                          <span className="text-[10px] font-semibold text-(--pos-text-3) uppercase tracking-wider">
                            {q.lines.length} {q.lines.length === 1 ? "item" : "items"}
                          </span>
                        </div>
                      </div>

                      {/* Meta Tags: Number, Date, Valid Until */}
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-(--pos-text-3)">
                        <span className="font-mono font-semibold px-2 py-0.5 rounded-md bg-(--pos-raised) text-(--pos-text-2) border border-(--pos-border)">
                          {q.quotationNumber || `Draft · ${q.localId.slice(0, 8)}`}
                        </span>

                        <span className="flex items-center gap-1">
                          <Clock className="size-3 text-(--pos-text-3)" />
                          {new Date(q.occurredAt).toLocaleDateString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </span>

                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                            q.synced
                              ? "bg-signal-green/10 text-signal-green"
                              : "bg-signal-amber/10 text-signal-amber"
                          }`}
                        >
                          {q.synced ? "Synced" : "Local Draft"}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="mt-4 flex items-center gap-2 border-t border-(--pos-border)/60 pt-3">
                      <button
                        type="button"
                        onClick={() => setSelectedQuotation(q)}
                        className="btn btn-ghost text-xs h-9 px-3 text-(--pos-text-2)"
                        title="View quotation line items"
                      >
                        <Eye className="size-3.5 mr-1" />
                        Details
                      </button>

                      <button
                        type="button"
                        onClick={() => printQuotationSlip(q)}
                        className="btn btn-ghost text-xs h-9 px-3 text-(--pos-text-2)"
                        title="Print quotation document"
                      >
                        <Printer className="size-3.5 mr-1" />
                        Print
                      </button>

                      <button
                        type="button"
                        disabled={isConverting}
                        onClick={() => void convertToSale(q)}
                        className="btn btn-primary text-xs h-9 px-4 flex-1 justify-center font-bold"
                      >
                        {isConverting ? (
                          <Loader2 className="size-3.5 animate-spin mr-1.5" />
                        ) : (
                          <ShoppingCart className="size-3.5 mr-1.5" />
                        )}
                        {isConverting ? "Loading Cart…" : "Convert to Sale"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Quotation Details Modal ── */}
      {selectedQuotation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-xl rounded-2xl border border-(--pos-border) bg-(--pos-panel) shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-(--pos-border) p-4 bg-(--pos-raised)/40">
              <div className="flex items-center gap-2.5">
                <FileText className="size-5 text-(--pos-accent)" />
                <div>
                  <h3 className="font-bold text-sm text-(--pos-text)">
                    Quotation #{selectedQuotation.quotationNumber || selectedQuotation.localId.slice(0, 8)}
                  </h3>
                  <p className="text-[11px] text-(--pos-text-3)">
                    {customers[selectedQuotation.customerId ?? ""]?.name ?? "Walk-in Customer"} ·{" "}
                    {new Date(selectedQuotation.occurredAt).toLocaleString("en-GB")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedQuotation(null)}
                className="btn btn-ghost size-8 p-0 rounded-full"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Line Items Table */}
            <div className="overflow-y-auto p-4 flex-1">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-(--pos-border) text-(--pos-text-3) text-[10px] uppercase font-bold tracking-wider">
                    <th className="pb-2">Product</th>
                    <th className="pb-2 text-right">Qty</th>
                    <th className="pb-2 text-right">Unit Price</th>
                    <th className="pb-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-(--pos-border)/50">
                  {selectedQuotation.lines.map((line, idx) => (
                    <tr key={`${line.variantId}-${idx}`} className="py-2">
                      <td className="py-2.5 pr-2">
                        <p className="font-semibold text-(--pos-text)">{line.productName}</p>
                        <p className="font-mono text-[10px] text-(--pos-text-3)">{line.productSku}</p>
                      </td>
                      <td className="py-2.5 text-right font-mono text-(--pos-text)">
                        {fmtQuantity(line.quantity)}
                      </td>
                      <td className="py-2.5 text-right font-mono text-(--pos-text-2)">
                        AED {parseFloat(line.unitPrice).toFixed(2)}
                        {Number(line.discountPercent) > 0 && (
                          <span className="block text-[10px] text-signal-green">
                            -{line.discountPercent}% off
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 text-right font-mono font-bold text-(--pos-text)">
                        AED {parseFloat(line.total).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Summary Totals */}
              <div className="mt-4 border-t border-(--pos-border) pt-3 space-y-1.5 text-xs">
                <div className="flex justify-between text-(--pos-text-2)">
                  <span>Subtotal</span>
                  <span className="font-mono">AED {parseFloat(selectedQuotation.subtotal).toFixed(2)}</span>
                </div>
                {Number(selectedQuotation.discountAmount) > 0 && (
                  <div className="flex justify-between text-signal-green">
                    <span>Discount</span>
                    <span className="font-mono">-AED {parseFloat(selectedQuotation.discountAmount).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-(--pos-text-2)">
                  <span>VAT (5%)</span>
                  <span className="font-mono">AED {parseFloat(selectedQuotation.taxAmount).toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold text-sm text-(--pos-text) border-t border-(--pos-border)/60 pt-2">
                  <span>Total Amount</span>
                  <span className="font-mono text-(--pos-accent)">
                    AED {parseFloat(selectedQuotation.total).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            {/* Modal Footer Actions */}
            <div className="border-t border-(--pos-border) p-4 flex items-center justify-between gap-3 bg-(--pos-raised)/30">
              <button
                type="button"
                onClick={() => setSelectedQuotation(null)}
                className="btn btn-ghost text-xs"
              >
                Close
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => printQuotationSlip(selectedQuotation)}
                  className="btn btn-ghost text-xs"
                >
                  <Printer className="size-3.5 mr-1" />
                  Print
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const q = selectedQuotation;
                    setSelectedQuotation(null);
                    void convertToSale(q);
                  }}
                  className="btn btn-primary text-xs font-bold"
                >
                  <ShoppingCart className="size-3.5 mr-1" />
                  Convert to Sale
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── KeyRail Shortcuts ── */}
      <KeyRail
        actions={[
          { combo: "Esc", label: "Back to sale", onPress: () => navigate("/") },
          { combo: "F7", label: "New quote", onPress: () => navigate("/") },
        ]}
      />
    </>
  );
}
