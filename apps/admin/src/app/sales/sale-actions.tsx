"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, Ban, Loader2, PackageOpen, Undo2 } from "lucide-react";
import { DEFAULT_TENANT_SETTINGS, type PaymentMethod } from "@devsfleet/shared-types";
import { Money, calculateDocument } from "@devsfleet/shared-utils";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Undoing a sale from the back office: void, or return part of it.
 *
 * The two are NOT interchangeable, and the API refuses to let them overlap —
 * so the interface has to make the difference legible rather than offering
 * two buttons that look like alternatives:
 *
 *   VOID   — this sale should never have existed. Every line is restocked,
 *            every payment reversed, the document kept and stamped. Refused
 *            once anything on it has been returned, because a sale with a
 *            real adjustment against it did happen.
 *   RETURN — some of it came back. A separate document, per line, with the
 *            goods either restocked or scrapped, and a refund that need not
 *            match how the sale was originally paid.
 *
 * Neither is a correction to the original row. `sales` and the inventory
 * ledger are append-only (CLAUDE.md rule 4): a void writes reversing payment
 * rows and stock movements, and a return writes a new document. Nothing here
 * edits history.
 */

// ── Contracts ────────────────────────────────────────────────────────────────

export interface ActionableSaleItem {
  id: string;
  productName: string;
  variantName: string;
  productSku: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxPercent: string;
  total: string;
  /** How much of this line has already gone back. Absent on older payloads. */
  returnedQuantity?: string;
}

export interface ActionableSale {
  id: string;
  saleNumber?: string;
  total: string;
  status: string;
  items?: ActionableSaleItem[];
  voidedAt?: string | null;
  /** Set when this document is itself a return — neither action applies. */
  returnOfSaleId?: string | null;
}

/**
 * Whether each action is open to this sale, and why not when it is closed.
 *
 * Mirrors the service's own guards (`void` and `createReturn` in
 * sales.service.ts) so the button explains itself instead of the operator
 * discovering the rule through a rejected request. The server still decides —
 * this is the interface telling the truth, not the control (rule 9).
 */
export function saleActionState(sale: ActionableSale | null): {
  canVoid: boolean;
  voidBlockedReason: string | null;
  canReturn: boolean;
  returnBlockedReason: string | null;
} {
  if (!sale) {
    return {
      canVoid: false,
      voidBlockedReason: null,
      canReturn: false,
      returnBlockedReason: null,
    };
  }

  if (sale.returnOfSaleId) {
    const reason = "This is a return document. Act on the original sale instead.";
    return {
      canVoid: false,
      voidBlockedReason: reason,
      canReturn: false,
      returnBlockedReason: reason,
    };
  }

  if (sale.status === "voided" || sale.voidedAt) {
    const reason = "This sale is already voided.";
    return {
      canVoid: false,
      voidBlockedReason: reason,
      canReturn: false,
      returnBlockedReason: "This sale was voided — there is nothing to return.",
    };
  }

  const partlyReturned = sale.status === "returned" || sale.status === "partially_returned";

  return {
    canVoid: !partlyReturned,
    voidBlockedReason: partlyReturned
      ? "Something on this sale has already been returned, so it did happen. Return what is left instead."
      : null,
    canReturn: sale.status !== "returned" || remainingLines(sale).length > 0,
    returnBlockedReason:
      sale.status === "returned" && remainingLines(sale).length === 0
        ? "Every line on this sale has already been returned."
        : null,
  };
}

/** Lines with something still left to take back. */
function remainingLines(sale: ActionableSale): Array<{ item: ActionableSaleItem; remaining: number }> {
  return (sale.items ?? [])
    .map((item) => ({
      item,
      remaining: Number(item.quantity) - Number(item.returnedQuantity ?? "0"),
    }))
    .filter((l) => l.remaining > 0.00005);
}

// ── Void ─────────────────────────────────────────────────────────────────────

export function VoidSaleDialog({
  sale,
  open,
  onClose,
  onDone,
  accessToken,
}: {
  sale: ActionableSale | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  accessToken: string | undefined;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
    }
  }, [open]);

  async function submit() {
    if (!sale || !reason.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/sales/${sale.id}/void`, { reason: reason.trim() }, { accessToken });
      onDone();
      onClose();
    } catch (err: any) {
      setError(err?.message || "The void was refused.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="size-5 text-destructive" />
            Void {sale?.saleNumber ?? "this sale"}
          </DialogTitle>
          <DialogDescription>
            For a sale that should never have been rung up. Everything on it goes back
            on the shelf and every payment is reversed.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-1 rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
          <li>· All {sale?.items?.length ?? 0} line(s) restocked in full, at the sale&rsquo;s branch.</li>
          <li>· Every payment taken is reversed.</li>
          <li>· The invoice stays downloadable, stamped <strong>VOIDED</strong>.</li>
          <li>· This cannot be undone — a void has no un-void.</li>
        </ul>

        <div>
          <label htmlFor="void-reason" className="mb-1 block text-xs font-medium">
            Reason <span className="text-destructive">*</span>
          </label>
          <Input
            id="void-reason"
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            placeholder="Rung up on the wrong customer"
            maxLength={500}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Recorded against your name on the audit trail.
          </p>
        </div>

        {error && (
          <p
            role="alert"
            className="flex items-start gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive"
          >
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void submit()}
            disabled={submitting || !reason.trim()}
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Voiding…
              </>
            ) : (
              "Void this sale"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Return ───────────────────────────────────────────────────────────────────

/**
 * Refund tenders offered here.
 *
 * Cash is present, unlike the admin sales terminal — and for the same reason
 * it is absent there. Handing cash OUT of a drawer this page cannot name has
 * the same reconciliation problem, so `cashSessionId` is null and a cash
 * refund booked here has to be settled against the till by hand. It is
 * offered because refusing it outright would leave no way to record a refund
 * the shop genuinely paid in notes.
 */
const REFUND_METHODS: Array<{ method: PaymentMethod; label: string }> = [
  { method: "card", label: "Card" },
  { method: "bank_transfer", label: "Bank transfer" },
  { method: "cash", label: "Cash" },
  { method: "store_credit", label: "Store credit" },
];

const TAX_MODE = DEFAULT_TENANT_SETTINGS.tax.mode;
const DECIMALS = DEFAULT_TENANT_SETTINGS.currency.decimals;

interface ReturnLineState {
  /** Quantity coming back, in the line's own sold unit. "" or "0" = not returning. */
  quantity: string;
  disposition: "restock" | "scrap";
}

export function ReturnSaleDialog({
  sale,
  open,
  onClose,
  onDone,
  accessToken,
  currency = DEFAULT_TENANT_SETTINGS.currency.base,
}: {
  sale: ActionableSale | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  accessToken: string | undefined;
  currency?: string;
}) {
  const [lines, setLines] = useState<Record<string, ReturnLineState>>({});
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>("card");
  const [refundReference, setRefundReference] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const returnable = useMemo(() => (sale ? remainingLines(sale) : []), [sale]);

  useEffect(() => {
    if (!open) return;
    setLines({});
    setRefundMethod("card");
    setRefundReference("");
    setRefundAmount("");
    setReason("");
    setError(null);
  }, [open]);

  function patch(itemId: string, patchState: Partial<ReturnLineState>) {
    setLines((current) => ({
      ...current,
      [itemId]: {
        quantity: current[itemId]?.quantity ?? "",
        disposition: current[itemId]?.disposition ?? "restock",
        ...patchState,
      },
    }));
  }

  /** Clamped to what is actually left on the line — the server refuses more. */
  function setQuantity(itemId: string, raw: string, remaining: number) {
    const clean = raw.replace(/[^\d.]/g, "");
    const parsed = Number(clean);
    const capped =
      Number.isFinite(parsed) && parsed > remaining
        ? String(Number(remaining.toFixed(4)))
        : clean;
    patch(itemId, { quantity: capped });
  }

  const selected = returnable
    .map(({ item, remaining }) => ({
      item,
      remaining,
      qty: Number(lines[item.id]?.quantity ?? "0"),
      disposition: lines[item.id]?.disposition ?? ("restock" as const),
    }))
    .filter((l) => l.qty > 0);

  /**
   * What the goods coming back are worth, at the ORIGINAL line's snapshot
   * price, discount and tax — the same inputs `createReturn` recomputes from,
   * so the figure previewed here is the one the server arrives at.
   */
  const totals = useMemo(
    () =>
      calculateDocument({
        taxMode: TAX_MODE,
        decimals: DECIMALS,
        lines: selected.map((l) => ({
          quantity: String(l.qty),
          unitPrice: l.item.unitPrice,
          discountPercent: l.item.discountPercent,
          taxPercent: l.item.taxPercent,
        })),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(selected.map((l) => [l.item.id, l.qty]))],
  );

  const dueBack = totals.total;
  /** Blank means "refund the whole value"; a figure means a partial payout. */
  const refund = refundAmount.trim() ? Money.toMinor(refundAmount) : dueBack;
  const overRefund = refund > dueBack;
  const absorbed = Money.subtract(dueBack, refund);

  async function submit() {
    if (!sale || selected.length === 0 || overRefund) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(
        "/sales/returns",
        {
          originalSaleId: sale.id,
          lines: selected.map((l) => ({
            saleItemId: l.item.id,
            quantity: l.qty,
            disposition: l.disposition,
          })),
          refunds: Money.isPositive(refund)
            ? [
                {
                  method: refundMethod,
                  amount: Number(Money.toDecimalString(refund, 2)),
                  ...(refundReference.trim() ? { reference: refundReference.trim() } : {}),
                },
              ]
            : [],
          /**
           * No drawer behind this page — see the note on REFUND_METHODS. Sent
           * explicitly so the intent is legible in the request itself.
           */
          cashSessionId: null,
          localId: crypto.randomUUID(),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        },
        { accessToken },
      );
      onDone();
      onClose();
    } catch (err: any) {
      setError(err?.message || "The return was refused.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="size-5 text-primary" />
            Return against {sale?.saleNumber ?? "this sale"}
          </DialogTitle>
          <DialogDescription>
            Take back some or all of it. Enter a quantity on each line coming back and
            say whether the goods are resellable.
          </DialogDescription>
        </DialogHeader>

        {returnable.length === 0 ? (
          <p className="rounded-lg border border-border bg-secondary/40 p-4 text-center text-xs text-muted-foreground">
            Nothing left to return on this sale.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {returnable.map(({ item, remaining }) => {
              const state = lines[item.id];
              const qty = Number(state?.quantity ?? "0");
              const active = qty > 0;
              const alreadyBack = Number(item.returnedQuantity ?? "0");

              return (
                <li key={item.id} className={cn("space-y-2 p-3", active && "bg-primary/5")}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {item.productName}
                        {item.variantName && item.variantName !== "Default"
                          ? ` — ${item.variantName}`
                          : ""}
                      </p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {item.productSku} · sold {Number(item.quantity)} @{" "}
                        {Number(item.unitPrice).toFixed(2)}
                        {alreadyBack > 0 && ` · ${alreadyBack} already returned`}
                      </p>
                    </div>
                    <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
                      {Number(remaining.toFixed(4))} left
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={state?.quantity ?? ""}
                      onChange={(e) => setQuantity(item.id, e.target.value, remaining)}
                      inputMode="decimal"
                      placeholder="0"
                      aria-label={`Quantity of ${item.productName} coming back`}
                      className="h-8 w-24 text-right font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setQuantity(item.id, String(Number(remaining.toFixed(4))), remaining)
                      }
                      className="h-8 text-[11px]"
                    >
                      All
                    </Button>

                    {/* Required per line — the server will not guess which happened. */}
                    <div className="flex overflow-hidden rounded-lg border border-input">
                      {(["restock", "scrap"] as const).map((value) => (
                        <button
                          key={value}
                          type="button"
                          disabled={!active}
                          onClick={() => patch(item.id, { disposition: value })}
                          className={cn(
                            "px-2.5 py-1 text-[11px] font-medium transition-colors",
                            !active && "cursor-not-allowed opacity-40",
                            active && (state?.disposition ?? "restock") === value
                              ? value === "restock"
                                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                              : "cursor-pointer text-muted-foreground hover:bg-accent",
                          )}
                        >
                          {value === "restock" ? "Resellable" : "Damaged"}
                        </button>
                      ))}
                    </div>

                    {active && (
                      <span className="ml-auto font-mono text-xs font-semibold">
                        {currency}{" "}
                        {Money.toDecimalString(
                          Money.multiplyByQuantity(Money.toMinor(item.unitPrice), l0(qty)),
                          2,
                        )}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {selected.length > 0 && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="refund-method" className="mb-1 block text-xs font-medium">
                  Refund by
                </label>
                <select
                  id="refund-method"
                  value={refundMethod}
                  onChange={(e) => setRefundMethod(e.target.value as PaymentMethod)}
                  className="h-9 w-full cursor-pointer rounded-lg border border-input bg-transparent px-3 text-sm"
                >
                  {REFUND_METHODS.map((m) => (
                    <option key={m.method} value={m.method}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="refund-ref" className="mb-1 block text-xs font-medium">
                  Reference
                </label>
                <Input
                  id="refund-ref"
                  value={refundReference}
                  onChange={(e) => setRefundReference(e.target.value)}
                  maxLength={100}
                  className="h-9"
                />
              </div>
            </div>

            <div>
              <label htmlFor="refund-amount" className="mb-1 block text-xs font-medium">
                Amount paid back ({currency})
              </label>
              <Input
                id="refund-amount"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
                placeholder={Money.toDecimalString(dueBack, 2)}
                className="h-9 text-right font-mono"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Leave empty to pay back the full {currency}{" "}
                {Money.toDecimalString(dueBack, 2)}. Pay back less and the difference
                comes off what the customer owes.
              </p>
            </div>

            <div>
              <label htmlFor="return-reason" className="mb-1 block text-xs font-medium">
                Reason
              </label>
              <Input
                id="return-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Wrong size"
                maxLength={500}
                className="h-9"
              />
            </div>

            <div className="space-y-1 rounded-lg border border-border bg-secondary/40 p-3 text-xs">
              <SummaryRow label="Goods coming back" value={`${currency} ${Money.toDecimalString(totals.subtotal, 2)}`} />
              <SummaryRow label="Tax" value={`${currency} ${Money.toDecimalString(totals.taxAmount, 2)}`} />
              <div className="flex items-baseline justify-between border-t border-border pt-1.5">
                <span className="text-sm font-semibold">Value returned</span>
                <span className="font-mono text-base font-bold">
                  {currency} {Money.toDecimalString(dueBack, 2)}
                </span>
              </div>
              {Money.isPositive(absorbed) && (
                <SummaryRow
                  label="Off the customer's balance"
                  value={`${currency} ${Money.toDecimalString(absorbed, 2)}`}
                />
              )}
            </div>

            {overRefund && (
              <p className="text-[11px] text-destructive">
                A refund cannot exceed the {currency} {Money.toDecimalString(dueBack, 2)}{" "}
                of goods coming back.
              </p>
            )}
          </>
        )}

        {error && (
          <p
            role="alert"
            className="flex items-start gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive"
          >
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={submitting || selected.length === 0 || overRefund}
            className="min-w-44"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Recording…
              </>
            ) : (
              <>
                <PackageOpen className="size-4" />
                Take back {currency} {Money.toDecimalString(dueBack, 2)}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** `Money.multiplyByQuantity` wants a MoneyInput; a raw number is fine but must be finite. */
function l0(value: number): string {
  return Number.isFinite(value) ? String(value) : "0";
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
