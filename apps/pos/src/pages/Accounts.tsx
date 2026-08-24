import type { PaymentMethod } from "@devsfleet/shared-types";
import { Money } from "@devsfleet/shared-utils";
import {
  AlertCircle,
  Banknote,
  CheckCircle2,
  CreditCard,
  FileText,
  Landmark,
  Loader2,
  Phone,
  Search,
  ShieldAlert,
  User,
  Wallet,
  X,
} from "lucide-react";
import React, { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog } from "../components/Dialog.js";
import { Keypad } from "../components/Keypad.js";
import { KeyRail } from "../components/KeyRail.js";
import { amount as fmtAmount, money, parseAmount } from "../lib/money.js";
import { posData, type PosCustomer, hasBridge } from "../lib/pos-data.js";
import { useAuth } from "../store/auth.js";

/**
 * B2B Customer Accounts & Debt Collections.
 *
 * Designed for trade counters:
 * - Real-time lookup of credit accounts & balances
 * - Clear visibility of credit limits, debt & available balance
 * - Instant settlement of outstanding balances via Cash, Card, or Transfer
 * - Integration with cash drawer and offline ledger sync
 */
export function Accounts() {
  const navigate = useNavigate();
  const { can } = useAuth();

  const [query, setQuery] = useState("");
  const [allCustomers, setAllCustomers] = useState<PosCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PosCustomer | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // Load all accounts with credit facilities on mount
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const customers = await posData.searchCustomers("");
        // Filter accounts that have a credit facility or an existing balance
        const creditAccounts = customers.filter(
          (c) =>
            Money.isPositive(Money.toMinor(c.creditLimit)) ||
            Money.isPositive(Money.toMinor(c.creditBalance)),
        );
        // Sort accounts with largest outstanding debt first
        creditAccounts.sort((a, b) => {
          const balA = Money.toMinor(a.creditBalance);
          const balB = Money.toMinor(b.creditBalance);
          return balA > balB ? -1 : balA < balB ? 1 : 0;
        });

        setAllCustomers(creditAccounts);
        if (creditAccounts.length > 0 && !selected) {
          setSelected(creditAccounts[0] ?? null);
        }
      } catch (err) {
        console.error("Failed to load customer accounts:", err);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  // Filter customers locally by query
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return allCustomers;

    return allCustomers.filter((c) => {
      const name = c.name.toLowerCase();
      const comp = c.company?.toLowerCase() ?? "";
      const phone = c.phone?.toLowerCase() ?? "";
      const trn = c.trn?.toLowerCase() ?? "";

      return (
        name.includes(q) ||
        comp.includes(q) ||
        phone.includes(q) ||
        trn.includes(q)
      );
    });
  }, [allCustomers, query]);

  function handlePaymentSuccess(paidMinor: Money.Minor4, customerName: string) {
    setReceiveOpen(false);
    if (!selected) return;

    const oldBal = Money.toMinor(selected.creditBalance);
    const newBal = Money.subtract(oldBal, paidMinor);
    const creditBalance = Money.toDecimalString(newBal, 4);

    const updated = { ...selected, creditBalance };
    setSelected(updated);

    // Update in list
    setAllCustomers((current) =>
      current.map((c) => (c.id === selected.id ? updated : c)),
    );

    setSuccessBanner(
      `Received ${money(paidMinor)} from ${customerName}. Remaining balance: ${money(newBal)}.`,
    );
    setTimeout(() => setSuccessBanner(null), 6000);
  }

  return (
    <div className="flex h-screen flex-col bg-[var(--pos-bg)] overflow-hidden">
      {/* ── Header ── */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--pos-border)] bg-[var(--pos-panel)] px-6">
        <div className="flex items-center gap-2.5">
          <Landmark className="size-5 text-[var(--pos-accent)]" />
          <div>
            <h1 className="text-sm font-bold tracking-tight text-[var(--pos-text)]">
              Accounts & Collections
            </h1>
            <p className="text-[11px] text-[var(--pos-text-3)]">
              Receive customer payments against credit ledgers
            </p>
          </div>
        </div>

        {successBanner && (
          <div className="flex items-center gap-2 rounded-lg bg-signal-green/10 border border-signal-green/30 px-3 py-1.5 text-xs text-signal-green font-medium animate-line-in">
            <CheckCircle2 className="size-3.5 shrink-0" />
            <span>{successBanner}</span>
          </div>
        )}
      </header>

      {/* ── Main 2-Pane Content ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left Pane: Customer List & Search ── */}
        <div className="w-80 sm:w-96 flex flex-col border-r border-[var(--pos-border)] bg-[var(--pos-panel)] shrink-0">
          {/* Search Box */}
          <div className="p-3.5 border-b border-[var(--pos-border)]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--pos-text-3)]" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search account, company, phone..."
                className="field num pl-9 text-xs w-full bg-[var(--pos-raised)] border-[var(--pos-border)]"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--pos-text-3)] hover:text-[var(--pos-text)]"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Customer Accounts List */}
          <ul className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading ? (
              <li className="text-center py-10 text-[var(--pos-text-3)] text-xs">
                <Loader2 className="size-6 animate-spin mx-auto mb-2 text-[var(--pos-accent)]" />
                Loading credit accounts…
              </li>
            ) : filtered.length === 0 ? (
              <li className="text-center text-[var(--pos-text-3)] text-xs py-10">
                {query ? `No accounts found matching "${query}"` : "No credit accounts found"}
              </li>
            ) : (
              filtered.map((customer) => {
                const bal = Money.toMinor(customer.creditBalance);
                const hasDebt = Money.isPositive(bal);
                const isSelected = selected?.id === customer.id;

                return (
                  <li key={customer.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(customer)}
                      className={[
                        "w-full text-left p-3.5 rounded-xl border transition-all cursor-pointer select-none",
                        isSelected
                          ? "bg-[var(--pos-raised)] border-[var(--pos-accent)] shadow-xs"
                          : "bg-[var(--pos-panel)] border-[var(--pos-border)] hover:bg-[var(--pos-raised)]/60",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-xs text-[var(--pos-text)] truncate">
                            {customer.name}
                          </p>
                          {customer.company && (
                            <p className="text-[11px] text-[var(--pos-text-3)] truncate mt-0.5">
                              {customer.company}
                            </p>
                          )}
                        </div>

                        {customer.creditOnHold && (
                          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-signal-red/10 text-signal-red border border-signal-red/30">
                            On Hold
                          </span>
                        )}
                      </div>

                      <div className="mt-2.5 flex items-center justify-between border-t border-[var(--pos-border)]/50 pt-2 text-xs">
                        <span className="text-[11px] text-[var(--pos-text-3)]">
                          Outstanding
                        </span>
                        <span
                          className={[
                            "num font-bold",
                            hasDebt ? "text-signal-amber font-mono" : "text-signal-green font-mono",
                          ].join(" ")}
                        >
                          {money(bal)}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>

        {/* ── Right Pane: Selected Account Details & Actions ── */}
        <div className="flex-1 bg-[var(--pos-bg)] p-6 md:p-8 flex flex-col overflow-y-auto">
          {selected ? (
            <div className="max-w-3xl space-y-6">
              {/* Account Header */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[var(--pos-border)] pb-5">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold text-[var(--pos-text)]">
                      {selected.name}
                    </h2>
                    {selected.creditOnHold ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-signal-red/10 border border-signal-red/30 px-2 py-0.5 text-xs font-bold text-signal-red">
                        <ShieldAlert className="size-3.5" />
                        Credit on Hold
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md bg-signal-green/10 border border-signal-green/30 px-2 py-0.5 text-xs font-semibold text-signal-green">
                        <CheckCircle2 className="size-3.5" />
                        Active Credit
                      </span>
                    )}
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[var(--pos-text-3)]">
                    {selected.company && <span>{selected.company}</span>}
                    {selected.phone && (
                      <span className="flex items-center gap-1">
                        <Phone className="size-3" />
                        {selected.phone}
                      </span>
                    )}
                    {selected.trn && (
                      <span className="font-mono">TRN: {selected.trn}</span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={!Money.isPositive(Money.toMinor(selected.creditBalance))}
                  onClick={() => setReceiveOpen(true)}
                  className="btn btn-primary h-11 px-6 text-sm font-bold shadow-xs shrink-0"
                >
                  <Banknote className="size-4 mr-1.5" />
                  Receive Payment (F5)
                </button>
              </div>

              {/* Debt & Credit Metric Cards */}
              {(() => {
                const balance = Money.toMinor(selected.creditBalance);
                const limit = Money.toMinor(selected.creditLimit);
                const available = Money.subtract(limit, balance);
                const isOverdue = Money.isPositive(balance);
                const isOverLimit = balance > limit;

                return (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {/* Outstanding Balance */}
                    <div className="rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-panel)] p-5 shadow-xs">
                      <span className="text-[11px] font-bold tracking-wider text-[var(--pos-text-3)] uppercase">
                        Outstanding Debt
                      </span>
                      <div
                        className={[
                          "mt-2 text-2xl font-bold font-mono",
                          isOverdue ? "text-signal-amber" : "text-signal-green",
                        ].join(" ")}
                      >
                        {money(balance)}
                      </div>
                      <p className="mt-1 text-[11px] text-[var(--pos-text-3)]">
                        {isOverdue ? "Requires settlement" : "Account fully settled"}
                      </p>
                    </div>

                    {/* Credit Limit */}
                    <div className="rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-panel)] p-5 shadow-xs">
                      <span className="text-[11px] font-bold tracking-wider text-[var(--pos-text-3)] uppercase">
                        Approved Limit
                      </span>
                      <div className="mt-2 text-2xl font-bold font-mono text-[var(--pos-text)]">
                        {money(limit)}
                      </div>
                      <p className="mt-1 text-[11px] text-[var(--pos-text-3)]">
                        Maximum credit allowance
                      </p>
                    </div>

                    {/* Available Balance */}
                    <div className="rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-panel)] p-5 shadow-xs">
                      <span className="text-[11px] font-bold tracking-wider text-[var(--pos-text-3)] uppercase">
                        Available Credit
                      </span>
                      <div
                        className={[
                          "mt-2 text-2xl font-bold font-mono",
                          isOverLimit ? "text-signal-red" : "text-[var(--pos-accent)]",
                        ].join(" ")}
                      >
                        {isOverLimit ? "AED 0.00" : money(available)}
                      </div>
                      <p className="mt-1 text-[11px] text-[var(--pos-text-3)]">
                        {isOverLimit ? "Exceeded approved limit" : "Available for new orders"}
                      </p>
                    </div>
                  </div>
                );
              })()}

              {/* Information Note */}
              <div className="rounded-xl border border-[var(--pos-border)] bg-[var(--pos-panel)] p-4 text-xs text-[var(--pos-text-2)] space-y-1">
                <p className="font-semibold text-[var(--pos-text)]">
                  Collections Policy
                </p>
                <p className="text-[11px] text-[var(--pos-text-3)]">
                  Payments collected in cash are attributed to the active till drawer session. Card and Bank Transfer collections record the transaction reference for bank reconciliation.
                </p>
              </div>
            </div>
          ) : (
            <div className="m-auto flex flex-col items-center justify-center text-[var(--pos-text-3)]">
              <Landmark className="size-16 mb-4 text-[var(--pos-text-3)]/30" />
              <p className="text-sm font-semibold text-[var(--pos-text)]">
                Select an account from the left
              </p>
              <p className="text-xs text-[var(--pos-text-3)] mt-1">
                View credit limits and collect customer payments
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Receive Payment Modal Dialog ── */}
      {receiveOpen && selected && (
        <ReceivePaymentDialog
          customer={selected}
          open={receiveOpen}
          onClose={() => setReceiveOpen(false)}
          onSuccess={(paid) => handlePaymentSuccess(paid, selected.name)}
        />
      )}

      {/* ── KeyRail ── */}
      <KeyRail
        actions={[
          { combo: "Esc", label: "Back to sale", onPress: () => navigate("/") },
          ...(selected && Money.isPositive(Money.toMinor(selected.creditBalance))
            ? [{ combo: "F5", label: "Receive payment", onPress: () => setReceiveOpen(true) }]
            : []),
        ]}
      />
    </div>
  );
}

// ── Receive Payment Dialog ───────────────────────────────────────────────────

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
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const max = Money.toMinor(customer.creditBalance);

  // Set default input to the full outstanding amount
  useEffect(() => {
    setInput(fmtAmount(max));
  }, [max]);

  const pending = parseAmount(input) ?? 0n;

  async function handleSubmit() {
    setError(null);
    if (!Money.isPositive(pending)) {
      setError("Please enter a valid payment amount greater than zero.");
      return;
    }
    if (pending > max) {
      setError("Cannot receive more than the outstanding customer balance.");
      return;
    }

    setSubmitting(true);
    try {
      // Get active drawer session if cash
      const session = await posData.getOpenCashSession();

      // Open drawer on cash if hardware bridge is present
      if (method === "cash" && hasBridge()) {
        try {
          await window.devsfleet.cashDrawer.open("Account collection settlement");
        } catch {
          // Hardware drawer failure does not block the collection ledger
        }
      }

      await posData.recordAccountPayment({
        customerId: customer.id,
        cashSessionId: method === "cash" ? session?.id || null : null,
        amount: Money.toDecimalString(pending, 2),
        method,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
        occurredAt: new Date().toISOString(),
      });

      onSuccess(pending);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record payment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Receive Account Settlement" width="lg">
      <div className="grid gap-6 sm:grid-cols-[1fr_16rem]">
        {/* Left Form */}
        <div className="space-y-4">
          {/* Customer Summary Banner */}
          <div className="rounded-xl border border-[var(--pos-border)] bg-[var(--pos-raised)] p-3 flex items-center justify-between text-xs">
            <div>
              <p className="font-bold text-[var(--pos-text)]">{customer.name}</p>
              <p className="text-[11px] text-[var(--pos-text-3)]">
                Outstanding: <span className="font-mono font-semibold text-signal-amber">{money(max)}</span>
              </p>
            </div>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-[var(--pos-panel)] text-[var(--pos-text-2)] border border-[var(--pos-border)]">
              Settle Debt
            </span>
          </div>

          {/* Payment Method Selector */}
          <div>
            <span className="eyebrow block mb-1.5">Payment Method</span>
            <div className="grid grid-cols-3 gap-2">
              {[
                { m: "cash", label: "Cash", Icon: Banknote },
                { m: "card", label: "Card", Icon: CreditCard },
                { m: "bank_transfer", label: "Bank Transfer", Icon: Landmark },
              ].map(({ m, label, Icon }) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m as PaymentMethod)}
                  className={[
                    "flex flex-col items-center gap-1.5 rounded-xl border p-2.5 text-xs font-semibold transition-all cursor-pointer",
                    method === m
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

          {/* Amount Field + Quick Presets */}
          <div>
            <div className="flex items-center justify-between">
              <label className="eyebrow">Amount (AED)</label>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setInput(fmtAmount(max))}
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[var(--pos-raised)] text-[var(--pos-accent)] hover:bg-[var(--pos-hover)] border border-[var(--pos-border)]"
                >
                  Full ({fmtAmount(max)})
                </button>
                <button
                  type="button"
                  onClick={() => setInput(fmtAmount(max / 2n))}
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[var(--pos-raised)] text-[var(--pos-text-2)] hover:bg-[var(--pos-hover)] border border-[var(--pos-border)]"
                >
                  50%
                </button>
              </div>
            </div>
            <input
              type="text"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError(null);
              }}
              className="field num mt-1.5 text-right text-xl font-bold bg-[var(--pos-raised)] border-[var(--pos-border)] text-[var(--pos-text)]"
              placeholder={fmtAmount(max)}
            />
            {pending > max && (
              <p className="mt-1 text-xs text-signal-red font-medium">
                Cannot receive more than the outstanding debt ({money(max)}).
              </p>
            )}
          </div>

          {/* Reference / Auth Code for Card & Transfer */}
          {method !== "cash" && (
            <div>
              <label className="eyebrow block">
                {method === "card" ? "Card Approval / Auth Code" : "Bank Transfer Reference #"}
              </label>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="field mt-1 text-xs bg-[var(--pos-raised)] border-[var(--pos-border)] text-[var(--pos-text)]"
                placeholder={method === "card" ? "e.g. AUTH-88239" : "e.g. FT-2026-99120"}
              />
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="rounded-lg bg-signal-red/10 border border-signal-red/30 p-2.5 text-xs text-signal-red font-medium">
              {error}
            </div>
          )}

          {/* Dialog Action Buttons */}
          <div className="pt-2 flex gap-3">
            <button
              type="button"
              className="btn btn-ghost flex-1 text-xs"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary flex-1 text-xs font-bold justify-center"
              disabled={submitting || !Money.isPositive(pending) || pending > max}
              onClick={() => void handleSubmit()}
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin mr-1.5" />
              ) : (
                <CheckCircle2 className="size-4 mr-1.5" />
              )}
              {submitting ? "Recording…" : "Record Payment"}
            </button>
          </div>
        </div>

        {/* Right Touch Keypad */}
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
