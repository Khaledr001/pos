import type { PaymentMethod } from "@devsfleet/shared-types";
import { Money } from "@devsfleet/shared-utils";
import { Search, Landmark, Banknote, CreditCard } from "lucide-react";
import { useEffect, useState } from "react";
import { amount as fmtAmount, money, parseAmount } from "../lib/money.js";
import { posData, type PosCustomer } from "../lib/pos-data.js";
import { Dialog } from "../components/Dialog.js";
import { Keypad } from "../components/Keypad.js";

export function Accounts() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PosCustomer[]>([]);
  const [selected, setSelected] = useState<PosCustomer | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const customers = await posData.searchCustomers(q);
      setResults(customers.filter((c) => Money.isPositive(Money.toMinor(c.creditLimit))));
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="flex h-screen flex-col bg-steel-900 overflow-hidden">
      <header className="flex h-[4.5rem] items-center justify-between border-b border-steel-800 bg-steel-900/95 px-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Accounts & Collections</h1>
          <p className="text-[13px] text-zinc-400">Search B2B customers to receive payments against their balance</p>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left column: Search */}
        <div className="w-96 flex flex-col border-r border-steel-800">
          <div className="p-4 border-b border-steel-800">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search customers..."
                className="w-full rounded-lg bg-steel-800 py-2.5 pl-9 pr-4 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-chalk"
              />
            </div>
          </div>
          
          <ul className="flex-1 overflow-y-auto p-4 space-y-2">
            {results.length === 0 && query.trim() !== "" && (
              <li className="text-center text-zinc-500 text-sm mt-4">No matching accounts found.</li>
            )}
            {results.map((customer) => (
              <li key={customer.id}>
                <button
                  type="button"
                  onClick={() => setSelected(customer)}
                  className={[
                    "w-full text-left p-3 rounded-lg border transition-colors",
                    selected?.id === customer.id
                      ? "bg-steel-800 border-chalk/30"
                      : "bg-steel-800/50 border-steel-700 hover:bg-steel-800"
                  ].join(" ")}
                >
                  <div className="font-medium text-white">{customer.name}</div>
                  {customer.company && <div className="text-xs text-zinc-400 mt-0.5">{customer.company}</div>}
                  <div className="mt-2 text-[11px] font-semibold tracking-wider text-chalk">
                    OWES {money(Money.toMinor(customer.creditBalance))}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Right column: Details & Action */}
        <div className="flex-1 bg-steel-950 p-8 flex flex-col">
          {selected ? (
            <AccountDetails
              customer={selected}
              onPaymentRecorded={(newBalance) => {
                const creditBalance = Money.toDecimalString(newBalance, 4);
                setSelected({ ...selected, creditBalance });
                // Also update the list silently so it reflects if clicked away and back
                setResults((current) =>
                  current.map((c) => (c.id === selected.id ? { ...c, creditBalance } : c))
                );
              }}
            />
          ) : (
            <div className="m-auto flex flex-col items-center justify-center text-zinc-500">
              <Landmark className="size-12 mb-4 opacity-20" />
              <p>Select an account to view details and collect payment</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AccountDetails({
  customer,
  onPaymentRecorded,
}: {
  customer: PosCustomer;
  onPaymentRecorded: (balance: Money.Minor4) => void;
}) {
  const [receiveOpen, setReceiveOpen] = useState(false);

  const balance = Money.toMinor(customer.creditBalance);
  const limit = Money.toMinor(customer.creditLimit);
  const available = Money.subtract(limit, balance);
  const isOverdue = Money.isPositive(balance);

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold text-white">{customer.name}</h2>
      {customer.company && <p className="text-zinc-400 mt-1">{customer.company}</p>}

      <div className="mt-8 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-steel-800 bg-steel-900 p-5">
          <div className="text-[11px] font-medium tracking-wider text-zinc-500 uppercase">Outstanding Balance</div>
          <div className="mt-2 text-2xl font-semibold text-white">{money(balance)}</div>
        </div>
        <div className="rounded-xl border border-steel-800 bg-steel-900 p-5">
          <div className="text-[11px] font-medium tracking-wider text-zinc-500 uppercase">Credit Limit</div>
          <div className="mt-2 text-2xl font-semibold text-white">{money(limit)}</div>
        </div>
        <div className="rounded-xl border border-steel-800 bg-steel-900 p-5">
          <div className="text-[11px] font-medium tracking-wider text-zinc-500 uppercase">Available Credit</div>
          <div className="mt-2 text-2xl font-semibold text-white">{money(available)}</div>
        </div>
      </div>

      <div className="mt-8">
        <button
          type="button"
          disabled={!isOverdue}
          onClick={() => setReceiveOpen(true)}
          className="btn btn-primary px-8 py-3"
        >
          Receive Payment
        </button>
      </div>

      {receiveOpen && (
        <ReceivePaymentDialog
          customer={customer}
          open={receiveOpen}
          onClose={() => setReceiveOpen(false)}
          onSuccess={(paid) => {
            setReceiveOpen(false);
            onPaymentRecorded(Money.subtract(balance, paid));
          }}
        />
      )}
    </div>
  );
}

function ReceivePaymentDialog({
  customer,
  open,
  onClose,
  onSuccess,
}: {
  customer: PosCustomer;
  open: boolean;
  onClose: () => void;
  onSuccess: (amount: Money.Minor4) => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [input, setInput] = useState("");
  const [reference, setReference] = useState("");

  const pending = parseAmount(input) ?? 0n;
  const max = Money.toMinor(customer.creditBalance);

  async function handleSubmit() {
    if (!Money.isPositive(pending) || pending > max) return;

    // Default cash session if cash
    const session = await posData.getOpenCashSession();

    await posData.recordAccountPayment({
      customerId: customer.id,
      cashSessionId: method === "cash" ? session?.id || null : null,
      amount: Money.toDecimalString(pending, 2),
      method,
      reference: reference.trim() || null,
      notes: null,
      occurredAt: new Date().toISOString(),
    });

    onSuccess(pending);
  }

  return (
    <Dialog open={open} onClose={onClose} title="Receive Account Payment" width="lg">
      <div className="grid gap-5 sm:grid-cols-[1fr_15rem]">
        <div className="space-y-4">
          <div>
            <span className="eyebrow">Method</span>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {[
                { m: "cash", label: "Cash", Icon: Banknote },
                { m: "card", label: "Card", Icon: CreditCard },
                { m: "bank_transfer", label: "Transfer", Icon: Landmark },
              ].map(({ m, label, Icon }) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m as PaymentMethod)}
                  className={[
                    "flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-[12px] font-medium transition-colors",
                    method === m
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

          <div>
            <label className="eyebrow block">Amount (AED)</label>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="field num mt-1.5 text-right text-xl font-semibold"
              placeholder={fmtAmount(max)}
            />
            {pending > max && (
              <p className="mt-1 text-xs text-signal-red">Cannot receive more than the outstanding balance.</p>
            )}
          </div>

          {method !== "cash" && (
            <div>
              <label className="eyebrow block">Reference</label>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="field mt-1.5"
                placeholder={method === "card" ? "Auth code" : "Transfer reference"}
              />
            </div>
          )}

          <div className="pt-2 flex gap-3">
            <button type="button" className="btn btn-ghost flex-1" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary flex-1"
              disabled={!Money.isPositive(pending) || pending > max}
              onClick={handleSubmit}
            >
              Record Payment
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <Keypad
            showDecimal
            onDigit={(d) => setInput((v) => v + d)}
            onBackspace={() => setInput((v) => v.slice(0, -1))}
            onClear={() => setInput("")}
          />
        </div>
      </div>
    </Dialog>
  );
}
