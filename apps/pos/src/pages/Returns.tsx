import { DEFAULT_TENANT_SETTINGS, type PaymentMethod } from "@devsfleet/shared-types";
import { Money, calculateDocument } from "@devsfleet/shared-utils";
import { Banknote, CreditCard, Landmark, Plus, Receipt, Search, Trash2, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog } from "../components/Dialog.js";
import { KeyRail } from "../components/KeyRail.js";
import { ProductSearch } from "../components/ProductSearch.js";
import { amount, money, quantity as fmtQuantity } from "../lib/money.js";
import { posData, type PosProduct, type PosSaleReceipt } from "../lib/pos-data.js";
import { useAuth } from "../store/auth.js";

/**
 * Returns, and exchanges.
 *
 * A return is always against an original sale — never a free-standing negative
 * amount. That constraint is the whole control: it caps what can come back at
 * what actually went out, keeps the refund priced at what the customer paid
 * rather than today's price, and leaves the original invoice untouched.
 *
 * The refund itself is recorded as a linked sale with negative quantities, so
 * the ledger stays append-only and the original document is never rewritten.
 *
 * Only a same-till original is supported — `posData.findSale` has no path to
 * a sale from another terminal until both have synced.
 *
 * EXCHANGE is a return plus a new sale, not a third kind of document — there
 * is no server concept of one. Both sides are recorded in full (the return
 * refunds its whole value, the new sale is paid in full) rather than netted
 * into a single partial tender: each document stays self-contained and
 * independently auditable, and a walk-in customer needs nothing extra to
 * support it. The net figure shown to the cashier — what actually changes
 * hands — is exactly the same number either way; only the bookkeeping behind
 * it differs from a single blended payment.
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
  const [reference, setReference] = useState("");
  const [sale, setSale] = useState<PosSaleReceipt | null>(null);
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

  /**
   * Most returns are same-day: the customer bought the wrong size an hour ago
   * and has walked back in. Listing this till's recent sales turns the common
   * case into one tap, and leaves typing an invoice number for the genuinely
   * older ones.
   */
  useEffect(() => {
    void posData.recentSales(8).then(setRecent);
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
    const found = await posData.findSale(trimmed);
    if (found) pickSale(found);
    else {
      setSale(null);
      setNotFound(true);
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
  /** Positive = the customer owes more; negative = they are still owed money. */
  const net = Money.subtract(exchangeTotal, refund);
  const activeSaleMethod = PAYMENT_METHODS_UI.find((m) => m.method === saleMethod);

  // An exchange still needs an actual return leg — the server refuses a
  // return with zero lines, and "buy something new, return nothing" is just
  // a sale, which belongs on the Sale screen instead.
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
        // The return already went through — do not let the cashier think
        // NOTHING happened and retry the whole exchange from scratch, which
        // would return the same lines twice.
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
        void posData.recentSales(8).then(setRecent);
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
    void posData.recentSales(8).then(setRecent);
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-5">
          {!allowed && (
            <p className="rounded-lg border border-signal-red/40 bg-signal-red/10 px-4 py-3 text-[13px] text-signal-red">
              Your role cannot process returns. Ask a manager to sign in.
            </p>
          )}

          <div className="panel p-5">
            <label htmlFor="sale-ref" className="eyebrow">
              Find the original sale
            </label>
            <div className="mt-2 flex gap-2">
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-500"
                  aria-hidden
                />
                <input
                  id="sale-ref"
                  autoFocus
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && find()}
                  className="field num pl-10"
                  placeholder="Invoice number from the receipt, e.g. INV-2026-000123"
                  disabled={!allowed}
                />
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={find}
                disabled={!allowed}
              >
                Find
              </button>
            </div>
            <p className="mt-2 text-[12px] text-zinc-500">
              Scan the barcode on the receipt, or type the number printed at the top.
            </p>
          </div>

          {notFound && (
            <p className="rounded-lg border border-steel-700 bg-steel-850 px-4 py-8 text-center text-[13px] text-zinc-500">
              No sale found for "{reference}". A sale made on another terminal
              only becomes searchable here after both have synced.
            </p>
          )}

          {!sale && (
            <div className="panel overflow-hidden">
              <h2 className="border-b border-steel-700 px-5 py-3.5 text-[13px] font-semibold">
                Recent sales from this till
              </h2>
              {recent.length === 0 ? (
                <p className="px-5 py-8 text-center text-[13px] text-zinc-500">
                  Nothing sold on this terminal yet. Once you ring up a sale it
                  appears here, so a same-day return needs no invoice number.
                </p>
              ) : (
                <ul>
                  {recent.map((entry) => (
                    <li key={entry.localId}>
                      <button
                        type="button"
                        disabled={!allowed}
                        onClick={() => pickSale(entry)}
                        className="flex w-full items-center gap-4 border-b border-steel-800 px-5 py-3 text-left transition-colors hover:bg-steel-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Receipt className="size-4 shrink-0 text-zinc-600" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="num text-[13px] font-medium">
                            {entry.saleNumber ?? "Awaiting invoice number"}
                          </div>
                          <div className="text-[11px] text-zinc-500">
                            {new Date(entry.occurredAt).toLocaleTimeString("en-GB", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}{" "}
                            · {entry.lines.length}{" "}
                            {entry.lines.length === 1 ? "item" : "items"}
                            {!entry.synced && " · not yet synced"}
                          </div>
                        </div>
                        <span className="num text-[13px] font-semibold">
                          {amount(Money.toMinor(entry.total))}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {sale && (
            <div className="panel overflow-hidden">
              <div className="flex items-center justify-between border-b border-steel-700 px-5 py-4">
                <div className="flex items-center gap-3">
                  <Receipt className="size-4 text-brass" aria-hidden />
                  <div>
                    <div className="num text-[14px] font-semibold">
                      {sale.saleNumber ?? "Not yet numbered"}
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      {new Date(sale.occurredAt).toLocaleString("en-GB", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="eyebrow">Sale total</div>
                  <div className="num text-[14px] font-semibold">
                    {amount(Money.toMinor(sale.total))}
                  </div>
                </div>
              </div>

              <ul>
                {sale.lines.map((line, index) => {
                  const key = String(index);
                  const max = Number(line.quantity);
                  const selected = quantities[key] ?? "";
                  const returning = Number(selected) > 0;
                  const disposition = dispositions[key] ?? "restock";

                  return (
                    <li
                      key={key}
                      className="flex items-center gap-4 border-b border-steel-800 px-5 py-3"
                    >
                      <span className="num w-5 text-right text-[11px] text-zinc-600">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">
                          {line.productName}
                        </div>
                        <div className="num mt-0.5 text-[11px] text-zinc-500">
                          {line.productSku} · sold {fmtQuantity(line.quantity)} ×{" "}
                          {amount(Money.toMinor(line.unitPrice))}
                        </div>
                      </div>

                      {returning && (
                        <div className="flex items-center gap-1 rounded-lg border border-steel-700 bg-steel-800 p-0.5">
                          <button
                            type="button"
                            onClick={() => setDispositions((d) => ({ ...d, [key]: "restock" }))}
                            className={[
                              "rounded px-2 py-1 text-[11px] font-medium transition-colors",
                              disposition === "restock"
                                ? "bg-brass/15 text-brass"
                                : "text-zinc-500 hover:text-chalk",
                            ].join(" ")}
                          >
                            Restock
                          </button>
                          <button
                            type="button"
                            onClick={() => setDispositions((d) => ({ ...d, [key]: "scrap" }))}
                            className={[
                              "rounded px-2 py-1 text-[11px] font-medium transition-colors",
                              disposition === "scrap"
                                ? "bg-signal-red/15 text-signal-red"
                                : "text-zinc-500 hover:text-chalk",
                            ].join(" ")}
                          >
                            Scrap
                          </button>
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <label htmlFor={`return-${key}`} className="eyebrow">
                          Return
                        </label>
                        <input
                          id={`return-${key}`}
                          value={selected}
                          onChange={(e) => {
                            const raw = Number(e.target.value);
                            // Cannot return more than was sold. The cap is the
                            // point of doing this against the original sale.
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
                          className="field num w-24 text-right"
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="tear flex items-baseline justify-between px-5 py-4">
                <span className="eyebrow">Refund due</span>
                <span className="num text-3xl font-bold text-brass">{money(refund)}</span>
              </div>
            </div>
          )}

          {sale && (
            <div className="panel overflow-hidden">
              <div className="flex items-center justify-between border-b border-steel-700 px-5 py-3.5">
                <h2 className="text-[13px] font-semibold">Exchange for something else</h2>
                <button
                  type="button"
                  className="btn btn-ghost gap-1.5 py-1.5! px-2.5! text-[12px]"
                  onClick={() => setAddItemOpen(true)}
                  disabled={!allowed}
                >
                  <Plus className="size-3.5" aria-hidden />
                  Add item
                </button>
              </div>

              {exchangeLines.length === 0 ? (
                <p className="px-5 py-6 text-center text-[12px] text-zinc-500">
                  Optional. Add new items here to exchange instead of just
                  refunding — the till settles only the difference.
                </p>
              ) : (
                <ul>
                  {exchangeLines.map((line) => (
                    <li
                      key={line.key}
                      className="flex items-center gap-4 border-b border-steel-800 px-5 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">
                          {line.product.name}
                        </div>
                        <div className="num mt-0.5 text-[11px] text-zinc-500">
                          {line.product.sku} · {amount(Money.toMinor(line.product.sellingPrice))}{" "}
                          each
                        </div>
                      </div>
                      <input
                        value={line.quantity}
                        onChange={(e) => setExchangeQuantity(line.key, e.target.value)}
                        inputMode="decimal"
                        className="field num w-20 text-right"
                        aria-label={`Quantity of ${line.product.name}`}
                      />
                      <button
                        type="button"
                        onClick={() => removeExchangeItem(line.key)}
                        aria-label={`Remove ${line.product.name}`}
                        className="rounded p-1.5 text-zinc-600 hover:bg-signal-red/15 hover:text-signal-red"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {isExchange && (
                <div className="tear flex items-baseline justify-between px-5 py-4">
                  <span className="eyebrow">
                    {Money.isNegative(net) ? "Refund due" : "Customer pays"}
                  </span>
                  <span className="num text-3xl font-bold text-brass">
                    {money(Money.abs(net))}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <KeyRail
        actions={[
          { combo: "Enter", label: "Find sale", onPress: find, disabled: !allowed },
          {
            combo: "F4",
            label: !canConfirm
              ? "Refund"
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
        ]}
      />

      <Dialog
        open={confirming}
        onClose={() => !submitting && setConfirming(false)}
        title={isExchange ? "Confirm the exchange" : "Confirm the refund"}
        description="This creates a linked return. The original invoice is not modified."
        width="sm"
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setConfirming(false)}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void submit()}
              disabled={submitting}
            >
              <Undo2 className="size-4" aria-hidden />
              {submitting
                ? "Recording…"
                : isExchange
                  ? Money.isNegative(net)
                    ? `Refund ${money(Money.abs(net))}`
                    : Money.isZero(net)
                      ? "Confirm"
                      : `Charge ${money(net)}`
                  : `Refund ${money(refund)}`}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-[13px] text-zinc-400">
            {anySelected
              ? `${money(refund)} goes back to the customer. Restocked lines return to sellable inventory at this branch; scrapped lines are written off.`
              : "No lines are being refunded in cash."}
            {isExchange &&
              " The new items are rung up as their own sale, priced today."}
          </p>

          {anySelected && (
            <div>
              <span className="eyebrow">Refund method</span>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {PAYMENT_METHODS_UI.map(({ method, label, icon: Icon }) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setRefundMethod(method)}
                    className={[
                      "flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-[12px] font-medium transition-colors",
                      refundMethod === method
                        ? "border-brass bg-brass/12 text-brass"
                        : "border-steel-700 bg-steel-800 text-zinc-400 hover:bg-steel-750",
                    ].join(" ")}
                  >
                    <Icon className="size-4" aria-hidden />
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-zinc-500">
                Independent of how the sale was paid — a card sale can be refunded
                in cash, and the reverse happens too.
              </p>
            </div>
          )}

          {anySelected && activeRefundMethod?.needsReference && (
            <div>
              <label htmlFor="refund-ref" className="eyebrow">
                Refund reference
              </label>
              <input
                id="refund-ref"
                value={refundReference}
                onChange={(e) => setRefundReference(e.target.value)}
                placeholder={refundMethod === "card" ? "Auth code" : "Transfer reference"}
                className="field mt-1.5"
                autoComplete="off"
              />
            </div>
          )}

          {isExchange && (
            <div>
              <span className="eyebrow">New items — payment method</span>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {PAYMENT_METHODS_UI.map(({ method, label, icon: Icon }) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setSaleMethod(method)}
                    className={[
                      "flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-[12px] font-medium transition-colors",
                      saleMethod === method
                        ? "border-brass bg-brass/12 text-brass"
                        : "border-steel-700 bg-steel-800 text-zinc-400 hover:bg-steel-750",
                    ].join(" ")}
                  >
                    <Icon className="size-4" aria-hidden />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isExchange && activeSaleMethod?.needsReference && (
            <div>
              <label htmlFor="sale-ref-input" className="eyebrow">
                Sale reference
              </label>
              <input
                id="sale-ref-input"
                value={saleReference}
                onChange={(e) => setSaleReference(e.target.value)}
                placeholder={saleMethod === "card" ? "Auth code" : "Transfer reference"}
                className="field mt-1.5"
                autoComplete="off"
              />
            </div>
          )}

          <div>
            <label htmlFor="return-reason" className="eyebrow">
              Reason (optional)
            </label>
            <input
              id="return-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Wrong size, changed mind, damaged…"
              className="field mt-1.5"
              autoComplete="off"
            />
          </div>
        </div>
      </Dialog>

      <Dialog
        open={addItemOpen}
        onClose={() => setAddItemOpen(false)}
        title="Add an exchange item"
        width="lg"
      >
        <div className="flex h-[28rem] flex-col">
          <ProductSearch onPick={addExchangeItem} />
        </div>
      </Dialog>
    </>
  );
}
