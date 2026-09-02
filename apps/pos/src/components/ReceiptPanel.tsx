import { Money } from "@devsfleet/shared-utils";
import { AlertTriangle, CreditCard, Minus, Plus, Trash2, UserPlus, X } from "lucide-react";
import React, { useEffect, useState } from "react";
import { Select } from "./Select.js";
import { amount, money, quantity as fmtQuantity, TAX } from "../lib/money.js";
import { posData, type PosVariantUnit } from "../lib/pos-data.js";
import {
  maxQuantityInLineUnit,
  scaledFloor,
  useCart,
  useCartTotals,
  useFloorViolations,
  type CartLine,
} from "../store/cart.js";

/**
 * The cart receipt panel.
 *
 * Typeset like the paper receipt:
 * - Numbered lines with quick quantity adjustments
 * - Monospaced currency columns
 * - Subtotal, discount & VAT calculations
 * - Instant "Take Payment" trigger
 */
export function ReceiptPanel({
  onPickCustomer,
  onEditLine,
  onCharge,
  chargeBlockedReason,
}: {
  onPickCustomer: () => void;
  onEditLine: (line: CartLine) => void;
  onCharge: () => void;
  /** Why payment cannot be taken right now, or null when it can. */
  chargeBlockedReason: string | null;
}) {
  const { lines, customer, setCustomer, removeLine, adjustQuantity, documentDiscountPercent } =
    useCart();
  const totals = useCartTotals();
  const violations = useFloorViolations();
  const violationKeys = new Set(violations.map((line) => line.key));

  return (
    <aside className="flex w-88 sm:w-[24rem] xl:w-100 shrink-0 flex-col border-l border-(--pos-border) bg-(--pos-panel)">
      {/* Customer Header */}
      <div className="border-b border-(--pos-border) p-2.5">
        {customer ? (
          <div className="flex items-center gap-2.5 rounded-xl bg-(--pos-raised) px-3 py-2 border border-(--pos-border)">
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-bold text-(--pos-text)">{customer.name}</div>
              {customer.company && (
                <div className="truncate text-[10px] text-(--pos-text-3)">{customer.company}</div>
              )}
            </div>
            {Number(customer.creditLimit) > 0 && (
              <div className="text-right">
                <div className="eyebrow text-[9px]">Credit left</div>
                <div className="num text-[11px] font-semibold text-(--pos-text-2)">
                  {amount(
                    Money.subtract(
                      Money.toMinor(customer.creditLimit),
                      Money.toMinor(customer.creditBalance),
                    ),
                  )}
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => setCustomer(null)}
              aria-label="Remove customer"
              className="rounded-lg p-1 text-(--pos-text-3) transition-colors hover:bg-(--pos-hover) hover:text-(--pos-text)"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onPickCustomer}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-(--pos-border) px-3 py-2 text-xs font-medium text-(--pos-text-3) transition-colors hover:border-(--pos-accent) hover:text-(--pos-text) hover:bg-(--pos-raised)/40"
          >
            <UserPlus className="size-3.5 text-(--pos-accent)" />
            Walk-in customer
            <kbd className="num ml-1 rounded-md bg-(--pos-raised) border border-(--pos-border) px-1.5 py-0.2 text-[9px] font-semibold">
              F2
            </kbd>
          </button>
        )}
      </div>

      {/* Cart Line Items */}
      <ol className="min-h-0 flex-1 overflow-y-auto divide-y divide-(--pos-border)/60 scrollbar-thin">
        {lines.length === 0 && (
          <li className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center text-(--pos-text-3)">
            <p className="text-xs font-semibold text-(--pos-text)">Cart is empty</p>
            <p className="text-[11px] text-(--pos-text-3)">
              Scan a barcode (F1), or search items on the left.
            </p>
          </li>
        )}

        {lines.map((line, index) => {
          const lineTotal = totals.lines[index];
          const flagged = violationKeys.has(line.key);

          return (
            <LineRow
              key={line.key}
              line={line}
              index={index}
              flagged={flagged}
              lineTotal={lineTotal ? amount(lineTotal.total) : "—"}
              adjustQuantity={adjustQuantity}
              removeLine={removeLine}
              onEditLine={onEditLine}
            />
          );
        })}
      </ol>

      {/* Totals Summary */}
      <div className="tear shrink-0 p-3.5 border-t border-(--pos-border) bg-(--pos-raised)/30">
        <dl className="space-y-1 text-xs">
          <Row label="Subtotal" value={amount(totals.subtotal)} />
          {Money.isPositive(totals.discountAmount) && (
            <Row
              label={
                documentDiscountPercent !== "0"
                  ? `Discount (${documentDiscountPercent}%)`
                  : "Discount"
              }
              value={`−${amount(totals.discountAmount)}`}
              tone="brass"
            />
          )}
          <Row
            label={`${TAX.label} ${TAX.defaultRate}%`}
            value={amount(totals.taxAmount)}
          />
        </dl>

        <div className="mt-2.5 flex items-baseline justify-between border-t border-(--pos-border)/60 pt-2">
          <span className="eyebrow text-xs">Total Amount</span>
          <span
            key={totals.total.toString()}
            className="num animate-total text-2xl md:text-3xl font-bold leading-none tracking-tight text-(--pos-accent)"
          >
            {money(totals.total)}
          </span>
        </div>

        {/* Charge Button */}
        <button
          type="button"
          onClick={onCharge}
          disabled={chargeBlockedReason !== null}
          className={[
            "mt-3 flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-3 transition-all cursor-pointer font-bold",
            chargeBlockedReason
              ? "cursor-not-allowed border border-(--pos-border) bg-(--pos-raised) text-(--pos-text-3)"
              : "bg-(--pos-accent) text-black hover:bg-(--pos-accent-alt) shadow-xs",
          ].join(" ")}
        >
          <span className="flex items-center gap-2">
            <CreditCard className="size-4.5" />
            <span className="text-sm">Take payment</span>
            <kbd
              className={[
                "num rounded px-1.5 py-0.5 text-[9px] font-bold",
                chargeBlockedReason ? "bg-(--pos-border) text-(--pos-text-3)" : "bg-black/15",
              ].join(" ")}
            >
              F4
            </kbd>
          </span>
          <span className="num text-base font-bold">{money(totals.total)}</span>
        </button>

        {chargeBlockedReason && (
          <p className="mt-1.5 text-center text-[10px] text-(--pos-text-3) font-medium">
            {chargeBlockedReason}
          </p>
        )}
      </div>
    </aside>
  );
}

function useVariantUnits(variantId: string): PosVariantUnit[] {
  const [units, setUnits] = useState<PosVariantUnit[]>([]);

  useEffect(() => {
    let cancelled = false;
    void posData.unitsForVariant(variantId).then((found) => {
      if (!cancelled) setUnits(found ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [variantId]);

  return units;
}

function LineRow({
  line,
  index,
  flagged,
  lineTotal,
  adjustQuantity,
  removeLine,
  onEditLine,
}: {
  line: CartLine;
  index: number;
  flagged: boolean;
  lineTotal: string;
  adjustQuantity: (key: string, delta: number) => void;
  removeLine: (key: string) => void;
  onEditLine: (line: CartLine) => void;
}) {
  const setLineUnit = useCart((s) => s.setLineUnit);
  const setQuantity = useCart((s) => s.setQuantity);
  const availableUnits = useVariantUnits(line.product.id);

  const [quantityText, setQuantityText] = useState(line.quantity);
  useEffect(() => setQuantityText(line.quantity), [line.quantity]);

  const stock = Number(line.product.stock);
  // In line.unit (e.g. Roll), not raw base-unit stock — see maxQuantityInLineUnit.
  const maxInLineUnit = maxQuantityInLineUnit(line);
  const maxReached = Number.isFinite(stock) && stock > 0 && Number(line.quantity) >= maxInLineUnit;
  const lineUnitAbbr = line.unit?.unitAbbr ?? line.product.unitAbbr;

  function commitQuantity() {
    const parsed = Number(quantityText);
    if (Number.isFinite(parsed) && parsed > 0) {
      setQuantity(line.key, quantityText);
    } else {
      setQuantityText(line.quantity);
    }
  }

  return (
    <li
      className={[
        "animate-line-in px-3 py-2 transition-colors",
        flagged ? "bg-signal-red/10" : "hover:bg-(--pos-raised)/40",
      ].join(" ")}
    >
      <div className="flex items-start gap-2">
        <span className="num mt-0.5 w-4 shrink-0 text-right text-[10px] text-(--pos-text-3) font-bold">
          {index + 1}
        </span>

        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onEditLine(line)}
            className="block w-full truncate text-left text-xs font-bold text-(--pos-text) hover:text-(--pos-accent) transition-colors"
            title="Edit price or discount"
          >
            {line.product.name}
          </button>

          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            {/* Stepper */}
            <div className="flex items-center rounded-md border border-(--pos-border) bg-(--pos-raised) overflow-hidden">
              <button
                type="button"
                onClick={() => adjustQuantity(line.key, -1)}
                aria-label={`Reduce quantity of ${line.product.name}`}
                className="px-1.5 py-0.5 text-(--pos-text-3) hover:text-(--pos-text) transition-colors"
              >
                <Minus className="size-2.5" />
              </button>
              <input
                value={quantityText}
                onChange={(e) => setQuantityText(e.target.value)}
                onBlur={commitQuantity}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                inputMode="decimal"
                aria-label={`Quantity of ${line.product.name}`}
                className="num w-9 border-0 bg-transparent text-center text-xs font-bold focus:outline-none"
              />
              <button
                type="button"
                disabled={maxReached}
                onClick={() => adjustQuantity(line.key, 1)}
                aria-label={`Increase quantity of ${line.product.name}`}
                className={`px-1.5 py-0.5 transition-colors ${
                  maxReached
                    ? "text-(--pos-text-3)/30 cursor-not-allowed"
                    : "text-(--pos-text-3) hover:text-(--pos-text)"
                }`}
                title={
                  maxReached
                    ? `Max available stock (${fmtQuantity(maxInLineUnit)} ${lineUnitAbbr}) reached`
                    : "Add one"
                }
              >
                <Plus className="size-2.5" />
              </button>
            </div>

            {availableUnits.length > 0 ? (
              <Select
                size="sm"
                value={line.unit?.id ?? ""}
                onChange={(unitId) => {
                  const chosen = availableUnits.find((u) => u.id === unitId) ?? null;
                  setLineUnit(line.key, chosen);
                }}
                aria-label={`Packaging for ${line.product.name}`}
                options={[
                  { value: "", label: line.product.unitAbbr },
                  ...availableUnits.map((u) => ({ value: u.id, label: u.unitAbbr })),
                ]}
                className="w-18"
              />
            ) : (
              <span className="text-[10px] text-(--pos-text-3)">{line.product.unitAbbr} ×</span>
            )}

            <span className="num text-[11px] text-(--pos-text-2) font-mono">
              {amount(Money.toMinor(line.unitPrice))}
            </span>

            {line.discountPercent !== "0" && (
              <span className="num rounded bg-signal-green/10 text-signal-green px-1 py-0.2 text-[9px] font-bold">
                −{line.discountPercent}%
              </span>
            )}
            {line.floorOverridden && (
              <span className="rounded bg-signal-amber/10 text-signal-amber px-1 py-0.2 text-[9px] font-bold">
                override
              </span>
            )}
          </div>

          {flagged && (
            <p className="mt-1 flex items-center gap-1 text-[10px] text-signal-red font-medium">
              <AlertTriangle className="size-2.5 shrink-0" />
              Below {amount(scaledFloor(line) ?? 0n)} floor — needs manager
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="num font-mono text-xs font-bold text-(--pos-text)">{lineTotal}</span>
          <button
            type="button"
            onClick={() => removeLine(line.key)}
            aria-label={`Remove ${line.product.name}`}
            className="rounded p-1 text-(--pos-text-3) hover:text-signal-red hover:bg-signal-red/10 transition-colors"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      </div>
    </li>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "brass";
}) {
  return (
    <div className="flex justify-between">
      <dt className="text-(--pos-text-3)">{label}</dt>
      <dd className={`num font-mono font-semibold ${tone === "brass" ? "text-(--pos-accent)" : "text-(--pos-text)"}`}>
        {value}
      </dd>
    </div>
  );
}
