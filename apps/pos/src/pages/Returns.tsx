import { DEFAULT_TENANT_SETTINGS, type PaymentMethod } from "@devsfleet/shared-types";
import { Money, calculateDocument } from "@devsfleet/shared-utils";
import {
  AlertCircle,
  ArrowRight,
  Banknote,
  CheckCircle2,
  CreditCard,
  Landmark,
  Loader2,
  Minus,
  Package,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  Trash2,
  Undo2,
  User,
  X,
} from "lucide-react";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog } from "../components/Dialog.js";
import { KeyRail } from "../components/KeyRail.js";
import { ProductSearch } from "../components/ProductSearch.js";
import { amount, money, quantity as fmtQuantity } from "../lib/money.js";
import { posData, type PosProduct, type PosSaleReceipt } from "../lib/pos-data.js";
import { useAuth } from "../store/auth.js";

/**
 * POS Returns & Exchanges.
 *
 * Enforces audit controls:
 * 1. Returns are linked to an original sale receipt to prevent unauthorized cash drains.
 * 2. Exchange handles both return & new sale in a single atomic transaction.
 * 3. Line items support Restock (returns to shelf inventory) or Scrap (written off).
 */

const TAX_MODE = DEFAULT_TENANT_SETTINGS.tax.mode;
const DECIMALS = DEFAULT_TENANT_SETTINGS.currency.decimals;

const PAYMENT_METHODS_UI: Array<{
  method: PaymentMethod;
  label: string;
  icon: typeof Banknote;
  needsReference?: boolean;
}> = [
  { method: "cash", label: "Cash", icon: Banknote },
  { method: "card", label: "Card", icon: CreditCard, needsReference: true },
  { method: "bank_transfer", label: "Transfer", icon: Landmark, needsReference: true },
];

interface ExchangeLine {
  key: string;
  product: PosProduct;
  quantity: string;
}

export function Returns({ cashSessionId }: { cashSessionId: string | null }) {
  const { can } = useAuth();
  const navigate = useNavigate();

  const [reference, setReference] = useState("");
  const [sale, setSale] = useState<PosSaleReceipt | null>(null);
  const [searching, setSearching] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [dispositions, setDispositions] = useState<Record<string, "restock" | "scrap">>({});
  const [confirming, setConfirming] = useState(false);
  const [recent, setRecent] = useState<PosSaleReceipt[]>([]);
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>("cash");
  const [refundReference, setRefundReference] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [exchangeLines, setExchangeLines] = useState<ExchangeLine[]>([]);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [saleMethod, setSaleMethod] = useState<PaymentMethod>("cash");
  const [saleReference, setSaleReference] = useState("");

  const allowed = can("sale:return");

  useEffect(() => {
    void posData.recentSales(8).then((list) => setRecent(list ?? []));
  }, []);

  function pickSale(found: PosSaleReceipt) {
    setSale(found);
    setNotFound(false);
    setQuantities({});
    setDispositions({});
    setReason("");
    setRefundMethod("cash");
    setRefundReference("");
    setExchangeLines([]);
    setSaleMethod("cash");
    setSaleReference("");
  }

  async function find() {
    const trimmed = reference.trim();
    if (!trimmed) return;
    setSearching(true);
    setNotFound(false);
    try {
      const found = await posData.findSale(trimmed);
      if (found) {
        pickSale(found);
      } else {
        setSale(null);
        setNotFound(true);
      }
    } catch {
      setNotFound(true);
    } finally {
      setSearching(false);
    }
  }

  const selectedLines = sale
    ? sale.lines
        .map((line, index) => ({ line, index, qty: Number(quantities[String(index)] ?? "0") }))
        .filter((l) => l.qty > 0)
    : [];

  const totals = calculateDocument({
    taxMode: TAX_MODE,
    decimals: DECIMALS,
    lines: selectedLines.map(({ line, qty }) => ({
      quantity: String(qty),
      unitPrice: line.unitPrice,
      discountPercent: line.discountPercent,
      taxPercent: line.taxPercent,
    })),
  });
  const refund = totals.total;
  const anySelected = Money.isPositive(refund);
  const activeRefundMethod = PAYMENT_METHODS_UI.find((m) => m.method === refundMethod);

  const exchangeTotals = calculateDocument({
    taxMode: TAX_MODE,
    decimals: DECIMALS,
    lines: exchangeLines.map((l) => ({
      quantity: l.quantity,
      unitPrice: l.product.sellingPrice,
      taxPercent: l.product.taxPercent,
    })),
  });
  const exchangeTotal = exchangeTotals.total;
  const isExchange = exchangeLines.length > 0;
  /** Positive = the customer owes more; negative = store owes refund to customer. */
  const net = Money.subtract(exchangeTotal, refund);
  const activeSaleMethod = PAYMENT_METHODS_UI.find((m) => m.method === saleMethod);

  const canConfirm = anySelected;

  function addExchangeItem(product: PosProduct) {
    setExchangeLines((lines) => [...lines, { key: crypto.randomUUID(), product, quantity: "1" }]);
    setAddItemOpen(false);
  }

  function removeExchangeItem(key: string) {
    setExchangeLines((lines) => lines.filter((l) => l.key !== key));
  }

  function setExchangeQuantity(key: string, raw: string) {
    setExchangeLines((lines) =>
      lines.map((l) => (l.key === key ? { ...l, quantity: raw === "" ? "" : raw } : l)),
    );
  }

  function handleReturnAll() {
    if (!sale) return;
    const allQ: Record<string, string> = {};
    sale.lines.forEach((l, idx) => {
      allQ[String(idx)] = String(l.quantity);
    });
    setQuantities(allQ);
  }

  function stepQuantity(idx: number, max: number, delta: number) {
    const key = String(idx);
    const curr = Number(quantities[key] ?? "0");
    const next = Math.max(0, Math.min(max, curr + delta));
    setQuantities((q) => ({ ...q, [key]: next === 0 ? "" : String(next) }));
  }

  async function submit() {
    if (!sale || !canConfirm || submitting) return;
    setSubmitting(true);

    const returnDraft = {
      localId: crypto.randomUUID(),
      originalSaleLocalId: sale.localId,
      customerId: sale.customerId,
      cashSessionId,
      lines: selectedLines.map(({ line, index, qty }) => ({
        originalLineIndex: index,
        variantId: line.variantId,
        productName: line.productName,
        productSku: line.productSku,
        quantity: String(qty),
        unitPrice: line.unitPrice,
        disposition: dispositions[String(index)] ?? ("restock" as const),
      })),
      subtotal: Money.toDecimalString(totals.subtotal, 2),
      taxAmount: Money.toDecimalString(totals.taxAmount, 2),
      discountAmount: Money.toDecimalString(totals.discountAmount, 2),
      total: Money.toDecimalString(totals.total, 2),
      refunds: anySelected
        ? [
            {
              method: refundMethod,
              amount: Money.toDecimalString(refund, 2),
              ...(refundReference.trim() ? { reference: refundReference.trim() } : {}),
            },
          ]
        : [],
      ...(reason.trim() ? { reason: reason.trim() } : {}),
      occurredAt: new Date().toISOString(),
    };

    try {
      await posData.commitReturn(returnDraft);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not record this return.");
      setSubmitting(false);
      return;
    }

    if (isExchange) {
      const saleDraft = {
        localId: crypto.randomUUID(),
        customerId: sale.customerId,
        cashSessionId,
        lines: exchangeLines.map((l) => ({
          variantId: l.product.id,
          productName: l.product.name,
          productSku: l.product.sku,
          quantity: l.quantity,
          unitPrice: l.product.sellingPrice,
          discountPercent: "0",
          taxPercent: l.product.taxPercent,
          total: Money.toDecimalString(
            Money.multiplyByQuantity(Money.toMinor(l.product.sellingPrice), l.quantity),
            2,
          ),
        })),
        subtotal: Money.toDecimalString(exchangeTotals.subtotal, 2),
        taxAmount: Money.toDecimalString(exchangeTotals.taxAmount, 2),
        discountAmount: Money.toDecimalString(exchangeTotals.discountAmount, 2),
        total: Money.toDecimalString(exchangeTotals.total, 2),
        payments: [
          {
            method: saleMethod,
            amount: Money.toDecimalString(exchangeTotal, 2),
            ...(saleReference.trim() ? { reference: saleReference.trim() } : {}),
          },
        ],
        occurredAt: new Date().toISOString(),
      };

      try {
        await posData.commitSale(saleDraft);
      } catch (err) {
        alert(
          `The return was recorded, but the new items could not be rung up: ${
            err instanceof Error ? err.message : "unknown error"
          }. Ring up the new items as a separate sale.`,
        );
        setSubmitting(false);
        setConfirming(false);
        setSale(null);
        setReference("");
        setQuantities({});
        setDispositions({});
        setExchangeLines([]);
        void posData.recentSales(8).then((list) => setRecent(list ?? []));
        return;
      }
    }

    setSubmitting(false);
    setConfirming(false);
    setSale(null);
    setReference("");
    setQuantities({});
    setDispositions({});
    setExchangeLines([]);
    void posData.recentSales(8).then((list) => setRecent(list ?? []));
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6 bg-[var(--pos-bg)]">
        <div className="mx-auto max-w-4xl space-y-5">
          {/* Permission warning */}
          {!allowed && (
            <div className="rounded-xl border border-signal-red/30 bg-signal-red/10 p-3.5 text-xs text-signal-red font-medium flex items-center gap-2">
              <AlertCircle className="size-4 shrink-0" />
              <span>Your current cashier role does not have permission to process returns. Please ask a manager.</span>
            </div>
          )}

          {/* ── Search Original Sale Box ── */}
          <div className="panel p-5 border border-[var(--pos-border)] rounded-2xl bg-[var(--pos-panel)] shadow-xs">
            <label htmlFor="sale-ref" className="eyebrow block text-xs font-bold uppercase tracking-wider text-[var(--pos-text-3)] mb-2">
              Find Original Sale Receipt
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--pos-text-3)]" />
                <input
                  id="sale-ref"
                  autoFocus
                  value={reference}
                  onChange={(e) => {
                    setReference(e.target.value);
                    setNotFound(false);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && void find()}
                  className="field num pl-10 text-xs w-full bg-[var(--pos-raised)] border-[var(--pos-border)] text-[var(--pos-text)]"
                  placeholder="Scan receipt barcode or type invoice number, e.g. INV-2026-000123"
                  disabled={!allowed}
                />
                {reference && (
                  <button
                    type="button"
                    onClick={() => {
                      setReference("");
                      setNotFound(false);
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--pos-text-3)] hover:text-[var(--pos-text)]"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              <button
                type="button"
                className="btn btn-primary text-xs px-5 font-bold"
                onClick={() => void find()}
                disabled={!allowed || searching || !reference.trim()}
              >
                {searching ? <Loader2 className="size-4 animate-spin" /> : "Find Sale"}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-[var(--pos-text-3)]">
              Scan barcode from thermal receipt or enter invoice reference.
            </p>
          </div>

          {/* Not Found Banner */}
          {notFound && (
            <div className="rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-panel)] p-8 text-center shadow-xs">
              <RotateCcw className="size-10 mx-auto text-[var(--pos-text-3)]/50 mb-2" />
              <p className="text-sm font-bold text-[var(--pos-text)]">
                No sale found matching &ldquo;{reference}&rdquo;
              </p>
              <p className="text-xs text-[var(--pos-text-3)] mt-1 max-w-md mx-auto">
                Check invoice number spelling. If the sale was made on another terminal, ensure both terminals have completed sync.
              </p>
            </div>
          )}

          {/* ── Recent Sales on this Till (When no sale is selected) ── */}
          {!sale && (
            <div className="panel border border-[var(--pos-border)] rounded-2xl bg-[var(--pos-panel)] shadow-xs overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--pos-border)] px-5 py-3.5 bg-[var(--pos-raised)]/40">
                <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--pos-text)] flex items-center gap-2">
                  <Receipt className="size-4 text-[var(--pos-accent)]" />
                  Recent Sales on this Counter
                </h2>
                <span className="text-[11px] text-[var(--pos-text-3)]">
                  Click to process same-day return
                </span>
              </div>

              {recent.length === 0 ? (
                <p className="p-8 text-center text-xs text-[var(--pos-text-3)]">
                  No sales recorded on this till yet. Completed sales will appear here for fast return processing.
                </p>
              ) : (
                <ul className="divide-y divide-[var(--pos-border)]/60">
                  {recent.map((entry) => (
                    <li key={entry.localId}>
                      <button
                        type="button"
                        disabled={!allowed}
                        onClick={() => pickSale(entry)}
                        className="flex w-full items-center justify-between p-4 text-left hover:bg-[var(--pos-raised)]/60 transition-colors cursor-pointer select-none"
                      >
                        <div className="flex items-center gap-3">
                          <div className="size-8 rounded-lg bg-[var(--pos-raised)] flex items-center justify-center text-[var(--pos-accent)]">
                            <Receipt className="size-4" />
                          </div>
                          <div>
                            <p className="font-mono font-bold text-xs text-[var(--pos-text)]">
                              {entry.saleNumber ?? `Draft · ${entry.localId.slice(0, 8)}`}
                            </p>
                            <p className="text-[11px] text-[var(--pos-text-3)]">
                              {new Date(entry.occurredAt).toLocaleTimeString("en-GB", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}{" "}
                              · {entry.lines.length} {entry.lines.length === 1 ? "item" : "items"}
                              {!entry.synced && " · local queue"}
                            </p>
                          </div>
                        </div>

                        <div className="text-right">
                          <span className="font-mono font-bold text-sm text-[var(--pos-text)] block">
                            AED {parseFloat(entry.total).toFixed(2)}
                          </span>
                          <span className="text-[10px] text-[var(--pos-accent)] font-semibold flex items-center gap-0.5 justify-end">
                            Select <ArrowRight className="size-3" />
                          </span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ── Active Sale Lines & Return Quantities ── */}
          {sale && (
            <div className="panel border border-[var(--pos-border)] rounded-2xl bg-[var(--pos-panel)] shadow-xs overflow-hidden space-y-0">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-[var(--pos-border)] p-4 bg-[var(--pos-raised)]/40">
                <div className="flex items-center gap-3">
                  <div className="size-9 rounded-xl bg-[var(--pos-accent)]/15 text-[var(--pos-accent)] flex items-center justify-center">
                    <Receipt className="size-4.5" />
                  </div>
                  <div>
                    <p className="font-mono font-bold text-sm text-[var(--pos-text)]">
                      {sale.saleNumber ?? `Sale · ${sale.localId.slice(0, 8)}`}
                    </p>
                    <p className="text-[11px] text-[var(--pos-text-3)]">
                      {new Date(sale.occurredAt).toLocaleString("en-GB", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleReturnAll}
                    className="btn btn-ghost text-xs h-8 px-2.5"
                  >
                    Return All Items
                  </button>

                  <button
                    type="button"
                    onClick={() => setSale(null)}
                    className="btn btn-ghost text-xs h-8 px-2.5 text-[var(--pos-text-3)]"
                  >
                    Change Sale
                  </button>
                </div>
              </div>

              {/* Items List */}
              <ul className="divide-y divide-[var(--pos-border)]/60">
                {sale.lines.map((line, index) => {
                  const key = String(index);
                  const max = Number(line.quantity);
                  const selectedQty = quantities[key] ?? "";
                  const returning = Number(selectedQty) > 0;
                  const disposition = dispositions[key] ?? "restock";

                  return (
                    <li key={key} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4">
                      {/* Product Details */}
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <span className="size-6 rounded bg-[var(--pos-raised)] text-[var(--pos-text-3)] font-mono text-[11px] font-bold flex items-center justify-center shrink-0">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-xs text-[var(--pos-text)] truncate">
                            {line.productName}
                          </p>
                          <p className="font-mono text-[11px] text-[var(--pos-text-3)]">
                            SKU: {line.productSku} · Sold {fmtQuantity(line.quantity)} × AED{" "}
                            {parseFloat(line.unitPrice).toFixed(2)}
                          </p>
                        </div>
                      </div>

                      {/* Controls: Disposition & Stepper */}
                      <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                        {returning && (
                          <div className="flex items-center rounded-lg border border-[var(--pos-border)] bg-[var(--pos-raised)] p-0.5 text-xs">
                            <button
                              type="button"
                              onClick={() => setDispositions((d) => ({ ...d, [key]: "restock" }))}
                              className={[
                                "px-2 py-1 rounded text-[11px] font-semibold transition-all",
                                disposition === "restock"
                                  ? "bg-[var(--pos-panel)] text-[var(--pos-text)] shadow-xs"
                                  : "text-[var(--pos-text-3)] hover:text-[var(--pos-text)]",
                              ].join(" ")}
                            >
                              Restock
                            </button>
                            <button
                              type="button"
                              onClick={() => setDispositions((d) => ({ ...d, [key]: "scrap" }))}
                              className={[
                                "px-2 py-1 rounded text-[11px] font-semibold transition-all",
                                disposition === "scrap"
                                  ? "bg-signal-red/10 text-signal-red font-bold"
                                  : "text-[var(--pos-text-3)] hover:text-[var(--pos-text)]",
                              ].join(" ")}
                            >
                              Scrap
                            </button>
                          </div>
                        )}

                        {/* Quantity Stepper */}
                        <div className="flex items-center rounded-lg border border-[var(--pos-border)] bg-[var(--pos-raised)] overflow-hidden">
                          <button
                            type="button"
                            onClick={() => stepQuantity(index, max, -1)}
                            className="px-2 py-1 text-[var(--pos-text-3)] hover:text-[var(--pos-text)] transition-colors"
                          >
                            <Minus className="size-3" />
                          </button>
                          <input
                            id={`return-${key}`}
                            value={selectedQty}
                            onChange={(e) => {
                              const raw = Number(e.target.value);
                              const clamped = Number.isFinite(raw)
                                ? Math.max(0, Math.min(raw, max))
                                : 0;
                              setQuantities((q) => ({
                                ...q,
                                [key]: e.target.value === "" ? "" : String(clamped),
                              }));
                            }}
                            inputMode="decimal"
                            placeholder="0"
                            disabled={!allowed}
                            className="w-12 text-center text-xs font-mono font-bold bg-transparent border-none focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => stepQuantity(index, max, 1)}
                            className="px-2 py-1 text-[var(--pos-text-3)] hover:text-[var(--pos-text)] transition-colors"
                          >
                            <Plus className="size-3" />
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* Refund Summary Tear Line */}
              <div className="border-t border-[var(--pos-border)] p-4 flex items-baseline justify-between bg-[var(--pos-raised)]/30">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--pos-text-3)]">
                  Refund Due from Return
                </span>
                <span className="font-mono text-2xl font-bold text-[var(--pos-accent)]">
                  AED {parseFloat(Money.toDecimalString(refund, 2)).toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {/* ── Exchange Items Section ── */}
          {sale && (
            <div className="panel border border-[var(--pos-border)] rounded-2xl bg-[var(--pos-panel)] shadow-xs overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--pos-border)] px-5 py-3.5 bg-[var(--pos-raised)]/40">
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--pos-text)]">
                    Exchange for Replacement Items
                  </h2>
                  <p className="text-[11px] text-[var(--pos-text-3)]">
                    Add new products to offset against the refund amount
                  </p>
                </div>

                <button
                  type="button"
                  className="btn btn-primary text-xs h-8 px-3"
                  onClick={() => setAddItemOpen(true)}
                  disabled={!allowed}
                >
                  <Plus className="size-3.5 mr-1" />
                  Add Item
                </button>
              </div>

              {exchangeLines.length === 0 ? (
                <p className="p-6 text-center text-xs text-[var(--pos-text-3)]">
                  Optional. If the customer is replacing with other goods, add them here to calculate the net difference.
                </p>
              ) : (
                <ul className="divide-y divide-[var(--pos-border)]/60">
                  {exchangeLines.map((line) => (
                    <li key={line.key} className="flex items-center justify-between gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-xs text-[var(--pos-text)] truncate">
                          {line.product.name}
                        </p>
                        <p className="font-mono text-[11px] text-[var(--pos-text-3)]">
                          {line.product.sku} · AED {parseFloat(line.product.sellingPrice).toFixed(2)} each
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <input
                          value={line.quantity}
                          onChange={(e) => setExchangeQuantity(line.key, e.target.value)}
                          inputMode="decimal"
                          className="field num w-16 text-center text-xs font-mono font-bold bg-[var(--pos-raised)] border-[var(--pos-border)]"
                          aria-label={`Quantity of ${line.product.name}`}
                        />
                        <button
                          type="button"
                          onClick={() => removeExchangeItem(line.key)}
                          aria-label={`Remove ${line.product.name}`}
                          className="size-8 rounded-lg text-[var(--pos-text-3)] hover:text-signal-red hover:bg-signal-red/10 flex items-center justify-center transition-colors"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {/* Net Balance calculation */}
              {isExchange && (
                <div className="border-t border-[var(--pos-border)] p-4 flex items-baseline justify-between bg-[var(--pos-raised)]/40">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--pos-text-3)] block">
                      {Money.isNegative(net) ? "Net Refund to Customer" : "Net Charge to Customer"}
                    </span>
                    <span className="text-[11px] text-[var(--pos-text-3)]">
                      Return AED {parseFloat(Money.toDecimalString(refund, 2)).toFixed(2)} vs Exchange AED {parseFloat(Money.toDecimalString(exchangeTotal, 2)).toFixed(2)}
                    </span>
                  </div>
                  <span className="font-mono text-2xl font-bold text-[var(--pos-accent)]">
                    AED {parseFloat(Money.toDecimalString(Money.abs(net), 2)).toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── KeyRail ── */}
      <KeyRail
        actions={[
          { combo: "Esc", label: "Back to sale", onPress: () => navigate("/") },
          ...(sale
            ? [
                {
                  combo: "F4",
                  label: !canConfirm
                    ? "Select items to refund"
                    : isExchange
                      ? Money.isNegative(net)
                        ? `Refund ${money(Money.abs(net))}`
                        : Money.isZero(net)
                          ? "Even exchange"
                          : `Charge ${money(net)}`
                      : `Refund ${money(refund)}`,
                  onPress: () => setConfirming(true),
                  disabled: !canConfirm || !allowed,
                  primary: true,
                },
              ]
            : []),
        ]}
      />

      {/* ── Confirmation Modal Dialog ── */}
      <Dialog
        open={confirming}
        onClose={() => !submitting && setConfirming(false)}
        title={isExchange ? "Confirm Exchange & Return" : "Confirm Customer Refund"}
        description="Records an audit-linked return against the original invoice."
        width="md"
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost text-xs"
              onClick={() => setConfirming(false)}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary text-xs font-bold"
              onClick={() => void submit()}
              disabled={submitting}
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin mr-1.5" />
              ) : (
                <Undo2 className="size-4 mr-1.5" />
              )}
              {submitting
                ? "Processing…"
                : isExchange
                  ? Money.isNegative(net)
                    ? `Process Refund (${money(Money.abs(net))})`
                    : Money.isZero(net)
                      ? "Complete Exchange"
                      : `Charge ${money(net)}`
                  : `Process Refund (${money(refund)})`}
            </button>
          </>
        }
      >
        <div className="space-y-4 text-xs">
          {/* Refund Method */}
          {anySelected && (
            <div>
              <span className="eyebrow block mb-1.5">Refund Payment Method</span>
              <div className="grid grid-cols-3 gap-2">
                {PAYMENT_METHODS_UI.map(({ method, label, icon: Icon }) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setRefundMethod(method)}
                    className={[
                      "flex flex-col items-center gap-1.5 rounded-xl border p-2.5 text-xs font-semibold transition-all cursor-pointer",
                      refundMethod === method
                        ? "border-[var(--pos-accent)] bg-[var(--pos-accent)]/10 text-[var(--pos-accent)] shadow-xs"
                        : "border-[var(--pos-border)] bg-[var(--pos-raised)] text-[var(--pos-text-2)] hover:bg-[var(--pos-hover)]",
                    ].join(" ")}
                  >
                    <Icon className="size-4" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Refund Reference if Card / Transfer */}
          {anySelected && activeRefundMethod?.needsReference && (
            <div>
              <label htmlFor="refund-ref" className="eyebrow block">
                Refund Auth / Transaction Reference
              </label>
              <input
                id="refund-ref"
                value={refundReference}
                onChange={(e) => setRefundReference(e.target.value)}
                placeholder={refundMethod === "card" ? "Card refund auth code" : "Bank transfer reference"}
                className="field mt-1 text-xs bg-[var(--pos-raised)] border-[var(--pos-border)] text-[var(--pos-text)]"
                autoComplete="off"
              />
            </div>
          )}

          {/* Exchange Payment Method if customer owes net difference */}
          {isExchange && Money.isPositive(net) && (
            <div>
              <span className="eyebrow block mb-1.5">Collect Remaining Balance Via</span>
              <div className="grid grid-cols-3 gap-2">
                {PAYMENT_METHODS_UI.map(({ method, label, icon: Icon }) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setSaleMethod(method)}
                    className={[
                      "flex flex-col items-center gap-1.5 rounded-xl border p-2.5 text-xs font-semibold transition-all cursor-pointer",
                      saleMethod === method
                        ? "border-[var(--pos-accent)] bg-[var(--pos-accent)]/10 text-[var(--pos-accent)] shadow-xs"
                        : "border-[var(--pos-border)] bg-[var(--pos-raised)] text-[var(--pos-text-2)] hover:bg-[var(--pos-hover)]",
                    ].join(" ")}
                  >
                    <Icon className="size-4" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Reason */}
          <div>
            <label htmlFor="return-reason" className="eyebrow block">
              Return Reason (Optional)
            </label>
            <input
              id="return-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Wrong size, customer changed mind, defective item"
              className="field mt-1 text-xs bg-[var(--pos-raised)] border-[var(--pos-border)] text-[var(--pos-text)]"
              autoComplete="off"
            />
          </div>
        </div>
      </Dialog>

      {/* ── Product Search Modal for Exchange ── */}
      <Dialog
        open={addItemOpen}
        onClose={() => setAddItemOpen(false)}
        title="Add Exchange Product"
        width="lg"
      >
        <div className="flex h-[28rem] flex-col">
          <ProductSearch onPick={addExchangeItem} />
        </div>
      </Dialog>
    </>
  );
}
