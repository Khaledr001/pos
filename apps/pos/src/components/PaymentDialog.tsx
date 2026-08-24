import type { PaymentMethod } from "@devsfleet/shared-types";
import { Money } from "@devsfleet/shared-utils";
import { Banknote, CreditCard, Landmark, Trash2, UserCheck } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { amount, money, parseAmount, roundCash } from "../lib/money.js";
import type { PosCustomer } from "../lib/pos-data.js";
import { useCart } from "../store/cart.js";
import { Dialog } from "./Dialog.js";
import { Keypad } from "./Keypad.js";
import { ManagerOverrideDialog } from "./ManagerOverrideDialog.js";

/**
 * POS Checkout Payment Dialog.
 *
 * Supports multi-tender / split payments:
 * - Cash (auto-rounded to UAE 25-fils coins)
 * - Card (with authorization code reference)
 * - Bank Transfer
 * - On Account / Credit (with customer credit limit enforcement and manager override)
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
  const [rounding, setRounding] = useState<Money.Minor4>(0n);
  const [creditOverrideAllowed, setCreditOverrideAllowed] = useState(false);
  const [showOverrideDialog, setShowOverrideDialog] = useState(false);

  const paid = useMemo(
    () => tenders.reduce<Money.Minor4>((sum, t) => Money.add(sum, t.amount), 0n),
    [tenders],
  );

  const covered = Money.add(paid, rounding);
  const outstanding = Money.subtract(total, covered);
  const settled = !Money.isPositive(outstanding);
  const change = settled ? Money.negate(outstanding) : 0n;

  const cashSettlement = roundCash(Money.max(outstanding, 0n));

  const creditAvailable = customer
    ? Money.subtract(
        Money.toMinor(customer.creditLimit),
        Money.toMinor(customer.creditBalance),
      )
    : 0n;

  useEffect(() => {
    if (open) {
      setTenders([]);
      setMethod("cash");
      setInput("");
      setReference("");
      setRounding(0n);
      setCreditOverrideAllowed(false);
    }
  }, [open]);

  const typed = parseAmount(input);
  const pending =
    typed ??
    (method === "cash" ? cashSettlement : Money.max(outstanding, 0n));

  const overrideNeeded = Boolean(
    method === "credit" && customer && (customer.creditOnHold || pending > creditAvailable),
  );

  const creditBlocked =
    method === "credit" &&
    (!customer || (overrideNeeded && !creditOverrideAllowed));

  function creditRefusal(): string | null {
    if (method !== "credit") return null;
    if (!customer) return "Select a customer before putting a sale on credit account.";
    if (creditOverrideAllowed) return null;
    if (customer.creditOnHold) return `${customer.name} is on credit hold.`;
    if (pending > creditAvailable)
      return `Only ${money(creditAvailable)} of credit remains on this account.`;
    return null;
  }

  function addTender() {
    if (!Money.isPositive(pending) || creditBlocked) return;

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

  function removeTender(id: string) {
    setTenders((current) => current.filter((t) => t.id !== id));
    setRounding(0n);
  }

  const activeMethod = METHODS.find((m) => m.method === method);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Take Payment"
      description={`${money(total)} total due`}
      width="lg"
      footer={
        <div className="flex items-center justify-end gap-2.5 w-full">
          <button type="button" className="btn btn-ghost text-xs" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary min-w-44 text-xs font-bold"
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
            {settled ? "Complete Sale (F4)" : `${money(outstanding)} Remaining`}
          </button>
        </div>
      }
    >
      <div className="grid gap-5 sm:grid-cols-[1fr_15rem]">
        <div className="space-y-4">
          {/* Payment Method Selector */}
          <div>
            <span className="eyebrow block mb-1.5">Payment Tender</span>
            <div className="grid grid-cols-4 gap-2">
              {METHODS.map(({ method: value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMethod(value)}
                  className={[
                    "flex flex-col items-center gap-1.5 rounded-xl border p-2.5 text-xs font-semibold transition-all cursor-pointer",
                    method === value
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

          {/* Tender Amount Input */}
          <div>
            <label htmlFor="tender-amount" className="eyebrow block mb-1">
              Amount to Collect (AED)
            </label>
            <input
              id="tender-amount"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTender()}
              inputMode="decimal"
              autoComplete="off"
              placeholder={amount(outstanding)}
              className="field num text-right text-xl font-bold bg-[var(--pos-raised)] border-[var(--pos-border)] text-[var(--pos-text)]"
            />
            <p className="mt-1 text-[11px] text-[var(--pos-text-3)]">
              {method === "cash" && cashSettlement !== outstanding && Money.isPositive(outstanding)
                ? `Leave empty to take ${money(cashSettlement)} (rounded to 25 fils cash coins).`
                : `Leave empty to take the full remaining ${money(Money.max(outstanding, 0n))}.`}
            </p>
          </div>

          {/* Reference for Card / Transfer */}
          {activeMethod?.needsReference && (
            <div>
              <label htmlFor="tender-ref" className="eyebrow block mb-1">
                Transaction Reference / Auth Code
              </label>
              <input
                id="tender-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={method === "card" ? "Card terminal auth code" : "Bank transfer reference"}
                className="field text-xs bg-[var(--pos-raised)] border-[var(--pos-border)] text-[var(--pos-text)]"
                autoComplete="off"
              />
            </div>
          )}

          {/* Credit refusal warning */}
          {creditRefusal() && (
            <p className="rounded-xl border border-signal-red/30 bg-signal-red/10 p-3 text-xs text-signal-red font-medium">
              {creditRefusal()}
            </p>
          )}

          {/* Manager override for credit */}
          {overrideNeeded && !creditOverrideAllowed && (
            <button
              type="button"
              className="btn border border-[var(--pos-accent)]/50 bg-[var(--pos-accent)]/10 text-[var(--pos-accent)] hover:bg-[var(--pos-accent)]/20 w-full text-xs font-semibold"
              onClick={() => setShowOverrideDialog(true)}
              disabled={!Money.isPositive(pending)}
            >
              Request Manager Credit Override
            </button>
          )}

          <button
            type="button"
            className="btn btn-ghost w-full text-xs font-bold border border-[var(--pos-border)]"
            onClick={addTender}
            disabled={!Money.isPositive(pending) || creditBlocked}
          >
            Add Tender: {money(pending)}
          </button>

          {/* Tenders taken so far list */}
          {tenders.length > 0 && (
            <div className="space-y-1.5 border-t border-[var(--pos-border)] pt-3">
              <span className="eyebrow block text-[10px]">Tenders Applied</span>
              <ul className="space-y-1">
                {tenders.map((tender) => {
                  const meta = METHODS.find((m) => m.method === tender.method);
                  return (
                    <li
                      key={tender.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-[var(--pos-border)] bg-[var(--pos-raised)] px-3 py-2 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[var(--pos-text)]">{meta?.label}</span>
                        {tender.reference && (
                          <span className="font-mono text-[11px] text-[var(--pos-text-3)]">
                            · {tender.reference}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-[var(--pos-text)]">
                          {amount(tender.amount)}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeTender(tender.id)}
                          aria-label="Remove payment"
                          className="rounded p-1 text-[var(--pos-text-3)] hover:bg-signal-red/10 hover:text-signal-red transition-colors"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {/* Touch Keypad + Balance breakdown */}
        <div className="space-y-3">
          <Keypad
            showDecimal
            onDigit={(d) => setInput((v) => v + d)}
            onBackspace={() => setInput((v) => v.slice(0, -1))}
            onClear={() => setInput("")}
          />

          <div className="space-y-2 rounded-xl border border-[var(--pos-border)] bg-[var(--pos-raised)] p-3 text-xs">
            <Line label="Total Due" value={amount(total)} />
            <Line label="Paid So Far" value={amount(paid)} />
            {Money.isPositive(rounding) && (
              <Line label="Rounding" value={`−${amount(rounding)}`} tone="brass" />
            )}
            <div className="border-t border-[var(--pos-border)] pt-2">
              {settled ? (
                <Line
                  label="Change Due"
                  value={amount(change)}
                  tone={Money.isPositive(change) ? "green" : "muted"}
                  large
                />
              ) : (
                <Line label="Remaining" value={amount(outstanding)} tone="brass" large />
              )}
            </div>
          </div>
        </div>
      </div>

      {showOverrideDialog && (
        <ManagerOverrideDialog
          open={showOverrideDialog}
          requiredPermission="customer:credit"
          onClose={() => setShowOverrideDialog(false)}
          onSuccess={(_managerName, grant) => {
            useCart.getState().addOverrideGrant(grant);
            setShowOverrideDialog(false);
            setCreditOverrideAllowed(true);
          }}
        />
      )}
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
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[var(--pos-text-3)] font-semibold">{label}</span>
      <span
        className={`font-mono font-bold ${large ? "text-lg" : "text-xs"} ${
          tone === "brass"
            ? "text-[var(--pos-accent)]"
            : tone === "green"
              ? "text-signal-green"
              : "text-[var(--pos-text)]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
