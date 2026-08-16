import type { PaymentMethod } from "@devsfleet/shared-types";
import { Money } from "@devsfleet/shared-utils";
import { Banknote, CreditCard, Landmark, Trash2, UserCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { amount, money, parseAmount, roundCash } from "../lib/money.js";
import type { PosCustomer } from "../lib/pos-data.js";
import { Dialog } from "./Dialog.js";
import { Keypad } from "./Keypad.js";

/**
 * Take payment.
 *
 * Split tender is the default capability, not a special mode: a contractor
 * paying part cash and part card is routine here, so payments accumulate into
 * a list and the dialog simply tracks what is still outstanding.
 *
 * Two rules are enforced before the sale can be completed:
 *
 *   1. Credit cannot exceed the customer's remaining limit, and a walk-in has
 *      no limit at all — you cannot put a sale on an account that does not
 *      exist.
 *   2. Cash rounds to the nearest 25 fils, because the UAE has no smaller coin.
 *      Card and transfer settle exactly. Skipping this is why a drawer ends the
 *      day a few fils out.
 */

interface TenderLine {
  id: string;
  method: PaymentMethod;
  amount: Money.Minor4;
  reference?: string;
}

const METHODS: Array<{
  method: PaymentMethod;
  label: string;
  icon: typeof Banknote;
  needsReference?: boolean;
}> = [
  { method: "cash", label: "Cash", icon: Banknote },
  { method: "card", label: "Card", icon: CreditCard, needsReference: true },
  { method: "bank_transfer", label: "Transfer", icon: Landmark, needsReference: true },
  { method: "credit", label: "On account", icon: UserCheck },
];

export function PaymentDialog({
  open,
  onClose,
  total,
  customer,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  total: Money.Minor4;
  customer: PosCustomer | null;
  onConfirm: (
    payments: Array<{ method: PaymentMethod; amount: string; reference?: string }>,
    change: Money.Minor4,
  ) => void;
}) {
  const [tenders, setTenders] = useState<TenderLine[]>([]);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [input, setInput] = useState("");
  const [reference, setReference] = useState("");
  /**
   * The fils written off when cash settles the bill.
   *
   * The UAE has no coin below 25 fils, so a bill of 174.31 is physically
   * settled with 174.25 and the remaining 0.06 is a rounding adjustment on the
   * sale. Rounding the TENDER instead of the BILL is the trap: it leaves 0.06
   * outstanding, which no amount of cash can ever clear, and the sale can never
   * be completed.
   */
  const [rounding, setRounding] = useState<Money.Minor4>(0n);

  const paid = useMemo(
    () => tenders.reduce<Money.Minor4>((sum, t) => Money.add(sum, t.amount), 0n),
    [tenders],
  );

  /** Rounding counts towards settlement — it is forgiven, not owed. */
  const covered = Money.add(paid, rounding);
  const outstanding = Money.subtract(total, covered);
  const settled = !Money.isPositive(outstanding);
  /** Overpayment only ever comes back as cash. */
  const change = settled ? Money.negate(outstanding) : 0n;

  /** What cash physically settles the remaining balance. */
  const cashSettlement = roundCash(Money.max(outstanding, 0n));

  const creditAvailable = customer
    ? Money.subtract(
        Money.toMinor(customer.creditLimit),
        Money.toMinor(customer.creditBalance),
      )
    : 0n;

  // Reset when reopened, so a previous sale's tenders cannot leak into this one.
  useEffect(() => {
    if (open) {
      setTenders([]);
      setMethod("cash");
      setInput("");
      setReference("");
      setRounding(0n);
    }
  }, [open]);

  const typed = parseAmount(input);
  /**
   * Empty input means "the rest of it" — the common case. For cash that is the
   * rounded figure, because that is what the customer can actually hand over.
   */
  const pending =
    typed ??
    (method === "cash" ? cashSettlement : Money.max(outstanding, 0n));

  const creditBlocked =
    method === "credit" &&
    (!customer || customer.creditOnHold || pending > creditAvailable);

  function creditRefusal(): string | null {
    if (method !== "credit") return null;
    if (!customer) return "Select a customer before putting a sale on account.";
    if (customer.creditOnHold) return `${customer.name} is on credit hold.`;
    if (pending > creditAvailable)
      return `Only ${money(creditAvailable)} of credit remains on this account.`;
    return null;
  }

  function addTender() {
    if (!Money.isPositive(pending) || creditBlocked) return;

    /**
     * A cash tender that reaches the rounded settlement figure closes the bill,
     * and the sub-25-fils remainder becomes the rounding adjustment. Anything
     * smaller is a genuine part-payment and leaves the balance owing.
     */
    if (method === "cash" && pending >= cashSettlement && Money.isPositive(outstanding)) {
      setRounding((current) =>
        Money.add(current, Money.subtract(outstanding, cashSettlement)),
      );
    }

    setTenders((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        method,
        amount: pending,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      },
    ]);
    setInput("");
    setReference("");
  }

  /** Removing a tender must give back the rounding it triggered. */
  function removeTender(id: string) {
    setTenders((current) => current.filter((t) => t.id !== id));
    setRounding(0n);
  }

  const activeMethod = METHODS.find((m) => m.method === method);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Take payment"
      description={`${money(total)} due`}
      width="lg"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary min-w-44"
            disabled={!settled}
            onClick={() =>
              onConfirm(
                tenders.map((t) => ({
                  method: t.method,
                  amount: Money.toDecimalString(t.amount, 2),
                  ...(t.reference ? { reference: t.reference } : {}),
                })),
                change,
              )
            }
          >
            {settled ? "Complete sale" : `${money(outstanding)} left`}
          </button>
        </>
      }
    >
      <div className="grid gap-5 sm:grid-cols-[1fr_15rem]">
        <div className="space-y-4">
          {/* Method */}
          <div>
            <span className="eyebrow">Method</span>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {METHODS.map(({ method: value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMethod(value)}
                  className={[
                    "flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-[12px] font-medium transition-colors",
                    method === value
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

          {/* Amount */}
          <div>
            <label htmlFor="tender-amount" className="eyebrow">
              Amount
            </label>
            <input
              id="tender-amount"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTender()}
              inputMode="decimal"
              autoComplete="off"
              placeholder={amount(outstanding)}
              className="field num mt-1.5 text-right text-xl font-semibold"
            />
            <p className="mt-1.5 text-[11px] text-zinc-500">
              {method === "cash" && cashSettlement !== outstanding && Money.isPositive(outstanding)
                ? `Leave blank to take ${money(cashSettlement)} — rounded to the nearest 25 fils, the smallest coin in circulation.`
                : `Leave blank to take the full remaining ${money(Money.max(outstanding, 0n))}.`}
            </p>
          </div>

          {activeMethod?.needsReference && (
            <div>
              <label htmlFor="tender-ref" className="eyebrow">
                Reference
              </label>
              <input
                id="tender-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={method === "card" ? "Auth code" : "Transfer reference"}
                className="field mt-1.5"
                autoComplete="off"
              />
            </div>
          )}

          {creditRefusal() && (
            <p className="rounded-lg border border-signal-red/40 bg-signal-red/10 px-3 py-2.5 text-[12px] text-signal-red">
              {creditRefusal()}
            </p>
          )}

          <button
            type="button"
            className="btn btn-ghost w-full"
            onClick={addTender}
            disabled={!Money.isPositive(pending) || creditBlocked}
          >
            Add {money(pending)}
          </button>

          {/* Tenders taken so far */}
          {tenders.length > 0 && (
            <ul className="space-y-1.5">
              {tenders.map((tender) => {
                const meta = METHODS.find((m) => m.method === tender.method);
                return (
                  <li
                    key={tender.id}
                    className="flex items-center gap-3 rounded-lg bg-steel-800 px-3 py-2"
                  >
                    <span className="flex-1 text-[13px]">
                      {meta?.label}
                      {tender.reference && (
                        <span className="num ml-2 text-[11px] text-zinc-500">
                          {tender.reference}
                        </span>
                      )}
                    </span>
                    <span className="num text-[13px] font-semibold">
                      {amount(tender.amount)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeTender(tender.id)}
                      aria-label="Remove payment"
                      className="rounded p-1 text-zinc-600 hover:bg-signal-red/15 hover:text-signal-red"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Keypad + running state */}
        <div className="space-y-3">
          <Keypad
            showDecimal
            onDigit={(d) => setInput((v) => v + d)}
            onBackspace={() => setInput((v) => v.slice(0, -1))}
            onClear={() => setInput("")}
          />

          <div className="space-y-2 rounded-lg bg-steel-800 p-3">
            <Line label="Due" value={amount(total)} />
            <Line label="Paid" value={amount(paid)} />
            {Money.isPositive(rounding) && (
              <Line label="Rounding" value={`−${amount(rounding)}`} tone="brass" />
            )}
            <div className="tear pt-2">
              {settled ? (
                <Line
                  label="Change"
                  value={amount(change)}
                  tone={Money.isPositive(change) ? "green" : "muted"}
                  large
                />
              ) : (
                <Line label="Left" value={amount(outstanding)} tone="brass" large />
              )}
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function Line({
  label,
  value,
  tone = "muted",
  large,
}: {
  label: string;
  value: string;
  tone?: "muted" | "brass" | "green";
  large?: boolean;
}) {
  const colours = {
    muted: "text-chalk",
    brass: "text-brass",
    green: "text-signal-green",
  };
  return (
    <div className="flex items-baseline justify-between">
      <span className="eyebrow">{label}</span>
      <span
        className={`num font-semibold ${large ? "text-xl" : "text-[13px]"} ${colours[tone]}`}
      >
        {value}
      </span>
    </div>
  );
}
