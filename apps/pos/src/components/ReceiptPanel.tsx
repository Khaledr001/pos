import { Money } from "@devsfleet/shared-utils";
import { AlertTriangle, Minus, Plus, Trash2, UserPlus, X } from "lucide-react";
import { amount, money, quantity as fmtQuantity, TAX } from "../lib/money.js";
import { useCart, useCartTotals, useFloorViolations, type CartLine } from "../store/cart.js";

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
    <aside className="flex w-[26rem] shrink-0 flex-col border-l border-steel-700 bg-steel-850">
      {/* Customer. Walk-in is the default; naming one is the exception. */}
      <div className="border-b border-steel-700 p-3">
        {customer ? (
          <div className="flex items-center gap-3 rounded-lg bg-steel-800 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{customer.name}</div>
              {customer.company && (
                <div className="truncate text-[11px] text-zinc-500">{customer.company}</div>
              )}
            </div>
            {Number(customer.creditLimit) > 0 && (
              <div className="text-right">
                <div className="eyebrow">Credit left</div>
                <div className="num text-[12px] text-zinc-400">
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
              className="rounded p-1 text-zinc-500 transition-colors hover:bg-steel-750 hover:text-chalk"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onPickCustomer}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-steel-700 px-3 py-2.5 text-[13px] text-zinc-400 transition-colors hover:border-steel-600 hover:text-chalk"
          >
            <UserPlus className="size-4" aria-hidden />
            Walk-in customer
            <kbd className="num ml-1 rounded bg-steel-800 px-1.5 py-0.5 text-[10px]">F2</kbd>
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
            <li
              key={line.key}
              className={[
                "animate-line-in border-b border-steel-800 px-3 py-2.5",
                flagged ? "bg-signal-red/8" : "",
              ].join(" ")}
            >
              <div className="flex items-start gap-2.5">
                <span className="num mt-0.5 w-5 shrink-0 text-right text-[11px] text-zinc-600">
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

                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex items-center rounded-md border border-steel-700 bg-steel-800">
                      <button
                        type="button"
                        onClick={() => adjustQuantity(line.key, -1)}
                        aria-label={`Reduce quantity of ${line.product.name}`}
                        className="px-2 py-1 text-zinc-400 transition-colors hover:text-chalk"
                      >
                        <Minus className="size-3" />
                      </button>
                      <span className="num min-w-11 text-center text-[13px] font-semibold">
                        {fmtQuantity(line.quantity)}
                      </span>
                      <button
                        type="button"
                        onClick={() => adjustQuantity(line.key, 1)}
                        aria-label={`Increase quantity of ${line.product.name}`}
                        className="px-2 py-1 text-zinc-400 transition-colors hover:text-chalk"
                      >
                        <Plus className="size-3" />
                      </button>
                    </div>

                    <span className="text-[11px] text-zinc-600">
                      {line.product.unitAbbr} ×
                    </span>
                    <span className="num text-[12px] text-zinc-400">
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
                      Below the {amount(
                        Money.toMinor(line.product.minSellingPrice ?? "0"),
                      )} floor price — needs a manager
                    </p>
                  )}
                </div>

                <div className="flex flex-col items-end gap-1.5">
                  <span className="num text-[14px] font-semibold">
                    {lineTotal ? amount(lineTotal.total) : "—"}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeLine(line.key)}
                    aria-label={`Remove ${line.product.name}`}
                    className="rounded p-1 text-zinc-600 transition-colors hover:bg-signal-red/15 hover:text-signal-red"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            </li>
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

        <div className="mt-3 flex items-baseline justify-between border-t border-steel-700 pt-3">
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
      <dt className="text-zinc-400">{label}</dt>
      <dd className={`num ${tone === "brass" ? "text-brass" : "text-chalk"}`}>{value}</dd>
    </div>
  );
}
