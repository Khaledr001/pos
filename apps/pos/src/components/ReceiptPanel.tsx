import { Money } from "@devsfleet/shared-utils";
import { AlertTriangle, Minus, Plus, Trash2, UserPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { amount, money, TAX } from "../lib/money.js";
import { posData, type PosVariantUnit } from "../lib/pos-data.js";
import {
  scaledFloor,
  useCart,
  useCartTotals,
  useFloorViolations,
  type CartLine,
} from "../store/cart.js";

/**
 * The cart, set as the receipt it will print.
 *
 * Deliberately typeset like the paper output: numbered lines, monospaced
 * columns, a dashed tear line above the totals. The cashier is then checking
 * one object rather than reconciling two representations of it, which is the
 * cheapest error reduction available on this screen.
 *
 * Line numbers are real information here, not decoration — a customer says
 * "take off number 3", and the same numbers appear on the printed receipt.
 */
export function ReceiptPanel({
  onPickCustomer,
  onEditLine,
}: {
  onPickCustomer: () => void;
  onEditLine: (line: CartLine) => void;
}) {
  const { lines, customer, setCustomer, removeLine, adjustQuantity, documentDiscountPercent } =
    useCart();
  const totals = useCartTotals();
  const violations = useFloorViolations();
  const violationKeys = new Set(violations.map((line) => line.key));

  return (
    <aside className="flex w-[26rem] shrink-0 flex-col border-l border-pos-border bg-pos-panel">
      {/* Customer. Walk-in is the default; naming one is the exception. */}
      <div className="border-b border-pos-border p-3">
        {customer ? (
          <div className="flex items-center gap-3 rounded-lg bg-pos-raised px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{customer.name}</div>
              {customer.company && (
                <div className="truncate text-[11px] text-pos-text-3">{customer.company}</div>
              )}
            </div>
            {Number(customer.creditLimit) > 0 && (
              <div className="text-right">
                <div className="eyebrow">Credit left</div>
                <div className="num text-[12px] text-pos-text-2">
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
              className="rounded p-1 text-pos-text-3 transition-colors hover:bg-pos-hover hover:text-pos-text"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onPickCustomer}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-pos-border px-3 py-2.5 text-[13px] text-pos-text-3 transition-colors hover:border-pos-text-3 hover:text-pos-text"
          >
            <UserPlus className="size-4" aria-hidden />
            Walk-in customer
            <kbd className="num ml-1 rounded bg-pos-raised px-1.5 py-0.5 text-[10px]">F2</kbd>
          </button>
        )}
      </div>

      {/* Lines */}
      <ol className="min-h-0 flex-1 overflow-y-auto">
        {lines.length === 0 && (
          <li className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-[13px] text-zinc-500">No items yet</p>
            <p className="text-[12px] text-zinc-600">
              Scan a barcode, or search on the left.
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

      {/* Totals. The tear line is where the paper would be torn off. */}
      <div className="tear shrink-0 p-4">
        <dl className="space-y-1.5 text-[13px]">
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

        <div className="mt-3 flex items-baseline justify-between border-t border-pos-border pt-3">
          <span className="eyebrow">Total</span>
          <span
            key={totals.total.toString()}
            className="num animate-total text-[2.75rem] font-bold leading-none tracking-tight text-brass"
          >
            {money(totals.total)}
          </span>
        </div>
      </div>
    </aside>
  );
}

/**
 * Packagings offered for one variant, fetched once per product shown and
 * cached for the life of this component — a dropdown's option list, not
 * anything the committed sale depends on, so there is no staleness risk in
 * holding it locally rather than on the cart line itself.
 */
function useVariantUnits(variantId: string): PosVariantUnit[] {
  const [units, setUnits] = useState<PosVariantUnit[]>([]);

  useEffect(() => {
    let cancelled = false;
    void posData.unitsForVariant(variantId).then((found) => {
      if (!cancelled) setUnits(found);
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

  // Local text while the cashier is mid-edit — a plain-string quantity like
  // "1.5" or "2 boxes" of screws needs to pass through an intermediate "1."
  // or "" without either committing as a value or deleting the line, which
  // is exactly what binding straight to `line.quantity` would do.
  const [quantityText, setQuantityText] = useState(line.quantity);
  useEffect(() => setQuantityText(line.quantity), [line.quantity]);

  function commitQuantity() {
    const parsed = Number(quantityText);
    if (Number.isFinite(parsed) && parsed > 0) {
      setQuantity(line.key, quantityText);
    } else {
      // Invalid or cleared mid-edit — revert rather than delete. Removing
      // the line is what the minus stepper is for, deliberately.
      setQuantityText(line.quantity);
    }
  }

  return (
    <li
      className={[
        "animate-line-in border-b border-pos-border px-3 py-2.5",
        flagged ? "bg-signal-red/8" : "",
      ].join(" ")}
    >
      <div className="flex items-start gap-2.5">
        <span className="num mt-0.5 w-5 shrink-0 text-right text-[11px] text-pos-text-3">
          {index + 1}
        </span>

        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onEditLine(line)}
            className="block w-full truncate text-left text-[13px] font-medium hover:text-brass"
            title="Edit price or discount"
          >
            {line.product.name}
          </button>

          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-md border border-pos-border bg-pos-raised">
              <button
                type="button"
                onClick={() => adjustQuantity(line.key, -1)}
                aria-label={`Reduce quantity of ${line.product.name}`}
                className="px-2 py-1 text-pos-text-3 transition-colors hover:text-pos-text"
              >
                <Minus className="size-3" />
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
                className="num w-12 border-0 bg-transparent text-center text-[13px] font-semibold focus:outline-none"
              />
              <button
                type="button"
                onClick={() => adjustQuantity(line.key, 1)}
                aria-label={`Increase quantity of ${line.product.name}`}
                className="px-2 py-1 text-pos-text-3 transition-colors hover:text-pos-text"
              >
                <Plus className="size-3" />
              </button>
            </div>

            {availableUnits.length > 0 ? (
              <select
                value={line.unit?.id ?? ""}
                onChange={(e) => {
                  const chosen = availableUnits.find((u) => u.id === e.target.value) ?? null;
                  setLineUnit(line.key, chosen);
                }}
                aria-label={`Unit for ${line.product.name}`}
                className="rounded-md border border-pos-border bg-pos-raised px-1.5 py-1 text-[11px] text-pos-text-2 focus:outline-none"
              >
                <option value="">{line.product.unitAbbr}</option>
                {availableUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.unitAbbr}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-[11px] text-pos-text-3">{line.product.unitAbbr} ×</span>
            )}

            <span className="num text-[12px] text-pos-text-2">
              {amount(Money.toMinor(line.unitPrice))}
            </span>

            {line.discountPercent !== "0" && (
              <span className="num rounded bg-brass/15 px-1.5 py-0.5 text-[10px] font-semibold text-brass">
                −{line.discountPercent}%
              </span>
            )}
            {line.floorOverridden && (
              <span className="rounded bg-signal-amber/15 px-1.5 py-0.5 text-[10px] font-semibold text-signal-amber">
                override
              </span>
            )}
          </div>

          {flagged && (
            <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-signal-red">
              <AlertTriangle className="size-3 shrink-0" aria-hidden />
              Below the {amount(scaledFloor(line) ?? 0n)} floor price — needs a manager
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <span className="num text-[14px] font-semibold">{lineTotal}</span>
          <button
            type="button"
            onClick={() => removeLine(line.key)}
            aria-label={`Remove ${line.product.name}`}
            className="rounded p-1 text-pos-text-3 transition-colors hover:bg-signal-red/15 hover:text-signal-red"
          >
            <Trash2 className="size-3.5" />
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
      <dt className="text-pos-text-2">{label}</dt>
      <dd className={`num ${tone === "brass" ? "text-brass" : "text-pos-text"}`}>{value}</dd>
    </div>
  );
}
