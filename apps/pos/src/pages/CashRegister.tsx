import { Money } from "@devsfleet/shared-utils";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  Clock,
  History,
  Lock,
  Plus,
  ShieldAlert,
  Unlock,
  Wallet,
  Zap,
} from "lucide-react";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog } from "../components/Dialog.js";
import { Keypad } from "../components/Keypad.js";
import { KeyRail } from "../components/KeyRail.js";
import { useHotkeys } from "../lib/keyboard.js";
import { amount, money, parseAmount } from "../lib/money.js";
import { hasBridge, posData, type PosCashSession } from "../lib/pos-data.js";

/**
 * The Cash Drawer Register.
 *
 * Controls cash float custody per shift:
 * - Recorded opening float
 * - Live expected drawer calculation (Float + Cash Sales + Pay-Ins - Pay-Outs)
 * - Blind closing reconciliation to prevent rubber-stamping
 * - Variance detection (Shortfall requires mandatory explanation note)
 */
export function CashRegister({
  session,
  onChanged,
}: {
  session: PosCashSession | null;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const [openDialog, setOpenDialog] = useState(false);
  const [closeDialog, setCloseDialog] = useState(false);
  const [movementDialog, setMovementDialog] = useState<"cash_in" | "cash_out" | null>(null);

  useHotkeys({
    f5: () => (session ? setMovementDialog("cash_in") : setOpenDialog(true)),
    f6: () => session && setMovementDialog("cash_out"),
    f8: () => session && setCloseDialog(true),
  });

  const expected = session
    ? Money.add(
        Money.toMinor(session.openingAmount),
        Money.toMinor(session.cashSales),
        Money.toMinor(session.cashIn),
        Money.negate(Money.toMinor(session.cashOut)),
      )
    : 0n;

  async function triggerDrawerPulse() {
    if (!hasBridge()) return;
    try {
      await window.devsfleet.cashDrawer.open("Cash drawer manual test");
    } catch {
      // Hardware failure does not block session
    }
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6 bg-(--pos-bg)">
        <div className="mx-auto max-w-3xl space-y-5">
          {/* ── Page Header ── */}
          <div className="flex items-center justify-between border-b border-(--pos-border) pb-4">
            <div className="flex items-center gap-2.5">
              <Wallet className="size-5 text-(--pos-accent)" />
              <div>
                <h1 className="text-base font-bold tracking-tight text-(--pos-text)">
                  Cash Register Drawer
                </h1>
                <p className="text-xs text-(--pos-text-3)">
                  Shift float reconciliation, cash movements and drawer counts
                </p>
              </div>
            </div>

            {session && hasBridge() && (
              <button
                type="button"
                onClick={() => void triggerDrawerPulse()}
                className="btn btn-ghost text-xs h-8 px-3"
                title="Send kick pulse to open physical drawer"
              >
                <Zap className="size-3.5 mr-1 text-signal-green" />
                Open Drawer (Kick)
              </button>
            )}
          </div>

          {/* ── Closed Drawer State ── */}
          {!session ? (
            <div className="panel border border-(--pos-border) rounded-2xl bg-(--pos-panel) flex flex-col items-center gap-4 px-6 py-16 text-center shadow-xs">
              <div className="size-16 rounded-2xl bg-(--pos-raised) flex items-center justify-center text-(--pos-text-3)">
                <Lock className="size-8" />
              </div>
              <div>
                <h2 className="text-base font-bold text-(--pos-text)">The Cash Drawer is Closed</h2>
                <p className="mt-1 text-xs text-(--pos-text-3) max-w-sm mx-auto">
                  Count the opening float in the cash drawer to start this shift and enable cash checkout.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary px-6 h-11 text-xs font-bold shadow-xs"
                onClick={() => setOpenDialog(true)}
              >
                <Unlock className="size-4 mr-1.5" />
                Open Drawer with Float (F5)
              </button>
            </div>
          ) : (
            <>
              {/* ── Active Session Audit Card ── */}
              <div className="panel border border-(--pos-border) rounded-2xl bg-(--pos-panel) p-5 shadow-xs space-y-5">
                {/* Header Status */}
                <div className="flex items-center justify-between border-b border-(--pos-border)/60 pb-3.5">
                  <div className="flex items-center gap-2">
                    <Clock className="size-4 text-(--pos-accent)" />
                    <div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-(--pos-text-3) block">
                        Drawer Session Active Since
                      </span>
                      <p className="font-mono text-xs font-semibold text-(--pos-text) mt-0.5">
                        {new Date(session.openedAt).toLocaleString("en-GB", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </p>
                    </div>
                  </div>

                  <span className="inline-flex items-center gap-1.5 rounded-full bg-signal-green/10 border border-signal-green/30 px-3 py-1 text-xs font-bold text-signal-green">
                    <span className="size-2 rounded-full bg-signal-green animate-pulse" />
                    Active Drawer
                  </span>
                </div>

                {/* Audit Grid Rows */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {/* Opening Float */}
                  <div className="rounded-xl border border-(--pos-border) bg-(--pos-raised) p-3.5">
                    <span className="text-[11px] font-semibold text-(--pos-text-3) block">
                      Opening Float
                    </span>
                    <span className="font-mono text-lg font-bold text-(--pos-text) mt-1 block">
                      {amount(Money.toMinor(session.openingAmount))}
                    </span>
                    <span className="text-[10px] text-(--pos-text-3)">Counted at start of shift</span>
                  </div>

                  {/* Cash Sales */}
                  <div className="rounded-xl border border-(--pos-border) bg-(--pos-raised) p-3.5">
                    <span className="text-[11px] font-semibold text-(--pos-text-3) block">
                      Cash Sales Revenue
                    </span>
                    <span className="font-mono text-lg font-bold text-signal-green mt-1 block">
                      +{amount(Money.toMinor(session.cashSales))}
                    </span>
                    <span className="text-[10px] text-(--pos-text-3)">From completed cash sales</span>
                  </div>

                  {/* Paid In */}
                  <div className="rounded-xl border border-(--pos-border) bg-(--pos-raised) p-3.5">
                    <span className="text-[11px] font-semibold text-(--pos-text-3) block">
                      Manual Cash In (Top-ups)
                    </span>
                    <span className="font-mono text-lg font-bold text-(--pos-text) mt-1 block">
                      +{amount(Money.toMinor(session.cashIn))}
                    </span>
                    <span className="text-[10px] text-(--pos-text-3)">Extra change / added float</span>
                  </div>

                  {/* Paid Out */}
                  <div className="rounded-xl border border-(--pos-border) bg-(--pos-raised) p-3.5">
                    <span className="text-[11px] font-semibold text-(--pos-text-3) block">
                      Manual Cash Out (Payouts)
                    </span>
                    <span
                      className={[
                        "font-mono text-lg font-bold mt-1 block",
                        Money.isPositive(Money.toMinor(session.cashOut))
                          ? "text-signal-amber"
                          : "text-(--pos-text)",
                      ].join(" ")}
                    >
                      {Money.isPositive(Money.toMinor(session.cashOut))
                        ? `−${amount(Money.toMinor(session.cashOut))}`
                        : amount(0n)}
                    </span>
                    <span className="text-[10px] text-(--pos-text-3)">Petty cash / vendor drops</span>
                  </div>
                </div>

                {/* Expected Drawer Total */}
                <div className="rounded-xl border border-(--pos-border) bg-(--pos-raised) p-4 flex items-baseline justify-between">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-(--pos-text-3) block">
                      Expected Cash in Drawer
                    </span>
                    <span className="text-[11px] text-(--pos-text-3)">
                      Float + Sales + Cash In − Cash Out
                    </span>
                  </div>
                  <span className="font-mono text-2xl md:text-3xl font-bold text-(--pos-accent)">
                    {money(expected)}
                  </span>
                </div>
              </div>

              {/* ── Action Buttons ── */}
              <div className="grid grid-cols-3 gap-3">
                <button
                  type="button"
                  className="btn btn-ghost h-12 text-xs font-bold justify-center"
                  onClick={() => setMovementDialog("cash_in")}
                >
                  <ArrowDownLeft className="size-4 text-signal-green mr-1.5" />
                  Pay In (F5)
                </button>

                <button
                  type="button"
                  className="btn btn-ghost h-12 text-xs font-bold justify-center"
                  onClick={() => setMovementDialog("cash_out")}
                >
                  <ArrowUpRight className="size-4 text-signal-amber mr-1.5" />
                  Pay Out (F6)
                </button>

                <button
                  type="button"
                  className="btn btn-primary h-12 text-xs font-bold justify-center"
                  onClick={() => setCloseDialog(true)}
                >
                  <Lock className="size-4 mr-1.5" />
                  Close Drawer (F8)
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── KeyRail ── */}
      <KeyRail
        actions={[
          { combo: "Esc", label: "Back to sale", onPress: () => navigate("/") },
          session
            ? { combo: "F5", label: "Pay in", onPress: () => setMovementDialog("cash_in") }
            : { combo: "F5", label: "Open drawer", onPress: () => setOpenDialog(true), primary: true },
          {
            combo: "F6",
            label: "Pay out",
            onPress: () => setMovementDialog("cash_out"),
            disabled: !session,
          },
          {
            combo: "F8",
            label: "Close drawer",
            onPress: () => setCloseDialog(true),
            disabled: !session,
          },
        ]}
      />

      {/* ── Amount Dialog (Open / Pay In / Pay Out) ── */}
      <AmountDialog
        open={openDialog}
        title="Open Cash Drawer"
        description="Count and enter the initial cash float physically in the till."
        label="Opening Float Amount (AED)"
        confirmLabel="Open Drawer"
        onClose={() => setOpenDialog(false)}
        onConfirm={async (value) => {
          if (hasBridge()) {
            try {
              await window.devsfleet.cashDrawer.open("Open shift float count");
            } catch {}
          }
          await posData.openCashSession(Money.toDecimalString(value, 2));
          setOpenDialog(false);
          onChanged();
        }}
      />

      <AmountDialog
        open={movementDialog !== null}
        title={movementDialog === "cash_in" ? "Record Cash In (Pay In)" : "Record Cash Out (Pay Out)"}
        description={
          movementDialog === "cash_in"
            ? "Cash added to the drawer outside of a sale (e.g. extra float, till top-up)."
            : "Cash removed from the drawer (e.g. petty cash expense, supplier payment, bank drop)."
        }
        label="Movement Amount (AED)"
        confirmLabel={movementDialog === "cash_in" ? "Record Pay In" : "Record Pay Out"}
        requireReason
        onClose={() => setMovementDialog(null)}
        onConfirm={async (value, reason) => {
          if (!movementDialog) return;
          if (hasBridge()) {
            try {
              await window.devsfleet.cashDrawer.open(`Cash movement: ${movementDialog}`);
            } catch {}
          }
          await posData.recordCashMovement(
            movementDialog,
            Money.toDecimalString(value, 2),
            reason ?? "",
          );
          setMovementDialog(null);
          onChanged();
        }}
      />

      {/* ── Close Drawer Reconciliation Dialog ── */}
      {session && (
        <CloseDrawerDialog
          open={closeDialog}
          expected={expected}
          onClose={() => setCloseDialog(false)}
          onConfirm={async (counted, notes) => {
            await posData.closeCashSession(Money.toDecimalString(counted, 2), notes);
            setCloseDialog(false);
            onChanged();
          }}
        />
      )}
    </>
  );
}

// ── Amount Dialog Sub-Component ──────────────────────────────────────────────

function AmountDialog({
  open,
  title,
  description,
  label,
  confirmLabel,
  requireReason,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  label: string;
  confirmLabel: string;
  requireReason?: boolean;
  onClose: () => void;
  onConfirm: (value: Money.Minor4, reason?: string) => Promise<void>;
}) {
  const [input, setInput] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const value = parseAmount(input);
  const ready = value !== null && Money.isPositive(value) && (!requireReason || reason.trim().length > 0);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      width="lg"
    >
      <div className="grid gap-6 sm:grid-cols-[1fr_16rem]">
        <div className="space-y-4">
          <div>
            <label htmlFor="amount-input" className="eyebrow block mb-1">
              {label}
            </label>
            <input
              id="amount-input"
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              inputMode="decimal"
              className="field num text-right text-2xl font-bold bg-(--pos-raised) border-(--pos-border) text-(--pos-text)"
              placeholder="0.00"
            />
          </div>

          {requireReason && (
            <div>
              <label htmlFor="movement-reason" className="eyebrow block mb-1">
                Reason for Movement (Mandatory)
              </label>
              <input
                id="movement-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="field text-xs bg-(--pos-raised) border-(--pos-border) text-(--pos-text)"
                placeholder="e.g. Petty cash for packaging, bank drop, till top-up"
              />
              <p className="mt-1 text-[11px] text-(--pos-text-3)">
                Recorded against your cashier name for audit trail logs.
              </p>
            </div>
          )}

          <div className="pt-2 flex gap-3">
            <button
              type="button"
              className="btn btn-ghost flex-1 text-xs"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary flex-1 text-xs font-bold justify-center"
              disabled={!ready || submitting}
              onClick={async () => {
                if (value) {
                  setSubmitting(true);
                  try {
                    await onConfirm(value, reason.trim() || undefined);
                    setInput("");
                    setReason("");
                  } finally {
                    setSubmitting(false);
                  }
                }
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </div>

        {/* Touch Keypad */}
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

// ── Close Drawer Blind Count Dialog ──────────────────────────────────────────

function CloseDrawerDialog({
  open,
  expected,
  onClose,
  onConfirm,
}: {
  open: boolean;
  expected: Money.Minor4;
  onClose: () => void;
  onConfirm: (counted: Money.Minor4, notes?: string) => Promise<void>;
}) {
  const [input, setInput] = useState("");
  const [notes, setNotes] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const counted = parseAmount(input);
  const variance = counted !== null ? Money.subtract(counted, expected) : null;
  const over = variance !== null && Money.isPositive(variance);
  const short = variance !== null && Money.isNegative(variance);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Close Shift Drawer (End of Shift Count)"
      description="Perform a blind physical count of cash currently in the drawer."
      width="lg"
    >
      <div className="grid gap-6 sm:grid-cols-[1fr_16rem]">
        <div className="space-y-4">
          <div>
            <label htmlFor="counted" className="eyebrow block mb-1">
              Physically Counted Amount (AED)
            </label>
            <input
              id="counted"
              autoFocus
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setRevealed(false);
              }}
              inputMode="decimal"
              className="field num text-right text-2xl font-bold bg-(--pos-raised) border-(--pos-border) text-(--pos-text)"
              placeholder="0.00"
            />
          </div>

          {!revealed && (
            <p className="text-[11px] text-(--pos-text-3) bg-(--pos-raised) p-2.5 rounded-lg">
              Target expected cash stays hidden until you submit your physical count to ensure an accurate, honest audit.
            </p>
          )}

          {revealed && variance !== null && (
            <div className="space-y-2.5 rounded-xl border border-(--pos-border) bg-(--pos-raised) p-3.5 text-xs animate-line-in">
              <div className="flex justify-between text-(--pos-text-2)">
                <span>Expected in Drawer</span>
                <span className="font-mono font-semibold">{amount(expected)}</span>
              </div>
              <div className="flex justify-between text-(--pos-text-2)">
                <span>Counted Amount</span>
                <span className="font-mono font-semibold">{amount(counted!)}</span>
              </div>
              <div className="border-t border-(--pos-border) flex items-baseline justify-between pt-2">
                <span className="font-bold uppercase tracking-wider text-(--pos-text-3)">
                  {short ? "Shortfall (Missing)" : over ? "Overage (Surplus)" : "Perfect Balance"}
                </span>
                <span
                  className={`font-mono text-base font-bold ${
                    short ? "text-signal-red" : over ? "text-signal-amber" : "text-signal-green"
                  }`}
                >
                  {amount(Money.abs(variance))}
                </span>
              </div>
            </div>
          )}

          {revealed && short && (
            <div>
              <label htmlFor="variance-notes" className="eyebrow block mb-1 text-signal-red">
                Explain the Shortfall (Mandatory)
              </label>
              <input
                id="variance-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="field text-xs bg-(--pos-raised) border-signal-red/50 text-(--pos-text)"
                placeholder="Reason for missing cash count..."
                autoFocus
              />
            </div>
          )}

          <div className="pt-2 flex gap-3">
            <button
              type="button"
              className="btn btn-ghost flex-1 text-xs"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            {!revealed ? (
              <button
                type="button"
                className="btn btn-primary flex-1 text-xs font-bold justify-center"
                disabled={counted === null}
                onClick={() => setRevealed(true)}
              >
                Check & Verify Count
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary flex-1 text-xs font-bold justify-center"
                disabled={counted === null || (short && !notes.trim()) || submitting}
                onClick={async () => {
                  if (counted !== null) {
                    setSubmitting(true);
                    try {
                      await onConfirm(counted, notes.trim() || undefined);
                      setInput("");
                      setNotes("");
                      setRevealed(false);
                    } finally {
                      setSubmitting(false);
                    }
                  }
                }}
              >
                {submitting ? "Closing…" : "Confirm & Close Drawer"}
              </button>
            )}
          </div>
        </div>

        {/* Touch Keypad */}
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
