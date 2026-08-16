import { Money } from "@devsfleet/shared-utils";
import { ArrowDownLeft, ArrowUpRight, Lock, Unlock } from "lucide-react";
import { useState } from "react";
import { Dialog } from "../components/Dialog.js";
import { KeyRail } from "../components/KeyRail.js";
import { useHotkeys } from "../lib/keyboard.js";
import { amount, money, parseAmount } from "../lib/money.js";
import { posData, type PosCashSession } from "../lib/pos-data.js";

/**
 * The cash drawer.
 *
 * One session per cashier per shift. The float going in and the count coming
 * out are both recorded, so the difference is stated rather than absorbed —
 * a drawer that is quietly reconciled is a drawer nobody can audit.
 *
 * The expected figure is computed and shown only AFTER the cashier has entered
 * their count. Showing the target first turns a count into a confirmation, and
 * a short drawer stops being visible.
 */
export function CashRegister({
  session,
  onChanged,
}: {
  session: PosCashSession | null;
  onChanged: () => void;
}) {
  const [openDialog, setOpenDialog] = useState(false);
  const [closeDialog, setCloseDialog] = useState(false);
  const [movementDialog, setMovementDialog] = useState<"cash_in" | "cash_out" | null>(
    null,
  );

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

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl space-y-5">
          {!session ? (
            <div className="panel flex flex-col items-center gap-4 px-6 py-14 text-center">
              <Lock className="size-8 text-zinc-600" aria-hidden />
              <div>
                <h2 className="text-base font-semibold">The drawer is closed</h2>
                <p className="mt-1 text-[13px] text-zinc-500">
                  Count the opening float and open the drawer to start selling.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setOpenDialog(true)}
              >
                <Unlock className="size-4" aria-hidden />
                Open drawer
              </button>
            </div>
          ) : (
            <>
              <div className="panel p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="eyebrow">Drawer open since</span>
                    <p className="num mt-1 text-[13px] text-zinc-300">
                      {new Date(session.openedAt).toLocaleString("en-GB", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                  </div>
                  <span className="rounded-full bg-signal-green/15 px-2.5 py-1 text-[11px] font-semibold text-signal-green">
                    Open
                  </span>
                </div>

                <dl className="mt-5 space-y-2.5 text-[14px]">
                  <Row label="Opening float" value={amount(Money.toMinor(session.openingAmount))} />
                  <Row label="Cash sales" value={amount(Money.toMinor(session.cashSales))} />
                  <Row label="Paid in" value={amount(Money.toMinor(session.cashIn))} />
                  <Row
                    label="Paid out"
                    // The sign is only meaningful when money actually left the
                    // drawer. "−0.00" reads as a defect.
                    value={
                      Money.isPositive(Money.toMinor(session.cashOut))
                        ? `−${amount(Money.toMinor(session.cashOut))}`
                        : amount(0n)
                    }
                  />
                </dl>

                <div className="tear mt-4 flex items-baseline justify-between pt-4">
                  <span className="eyebrow">Expected in drawer</span>
                  <span className="num text-2xl font-bold text-brass">
                    {money(expected)}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setMovementDialog("cash_in")}
                >
                  <ArrowDownLeft className="size-4 text-signal-green" aria-hidden />
                  Pay in
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setMovementDialog("cash_out")}
                >
                  <ArrowUpRight className="size-4 text-signal-amber" aria-hidden />
                  Pay out
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setCloseDialog(true)}
                >
                  <Lock className="size-4" aria-hidden />
                  Close drawer
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <KeyRail
        actions={[
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

      <AmountDialog
        open={openDialog}
        title="Open the drawer"
        description="Count the float that is physically in the drawer now."
        label="Opening float"
        confirmLabel="Open drawer"
        onClose={() => setOpenDialog(false)}
        onConfirm={async (value) => {
          await posData.openCashSession(Money.toDecimalString(value, 2));
          setOpenDialog(false);
          onChanged();
        }}
      />

      <AmountDialog
        open={movementDialog !== null}
        title={movementDialog === "cash_in" ? "Pay in" : "Pay out"}
        description={
          movementDialog === "cash_in"
            ? "Cash added to the drawer from outside a sale."
            : "Cash removed from the drawer — a supplier paid in cash, a float taken to the bank."
        }
        label="Amount"
        confirmLabel="Record"
        requireReason
        onClose={() => setMovementDialog(null)}
        onConfirm={async (value, reason) => {
          if (!movementDialog) return;
          await posData.recordCashMovement(
            movementDialog,
            Money.toDecimalString(value, 2),
            reason ?? "",
          );
          setMovementDialog(null);
          onChanged();
        }}
      />

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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-zinc-400">{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

// -----------------------------------------------------------------------------

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
  const value = parseAmount(input);
  const ready = value !== null && Money.isPositive(value) && (!requireReason || reason.trim());

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      width="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!ready}
            onClick={async () => {
              if (value) await onConfirm(value, reason.trim() || undefined);
              setInput("");
              setReason("");
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <label htmlFor="amount-input" className="eyebrow">
        {label}
      </label>
      <input
        id="amount-input"
        autoFocus
        value={input}
        onChange={(e) => setInput(e.target.value)}
        inputMode="decimal"
        className="field num mt-1.5 text-right text-2xl font-semibold"
        placeholder="0.00"
      />

      {requireReason && (
        <>
          <label htmlFor="movement-reason" className="eyebrow mt-4 block">
            Reason
          </label>
          <input
            id="movement-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="field mt-1.5"
            placeholder="Why is this cash moving?"
          />
          {/* Mandatory on purpose: an unexplained drawer movement is exactly
              what a shrinkage report goes looking for. */}
          <p className="mt-1.5 text-[11px] text-zinc-500">
            Recorded against your name and shown in the shrinkage report.
          </p>
        </>
      )}
    </Dialog>
  );
}

// -----------------------------------------------------------------------------

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

  const counted = parseAmount(input);
  const variance = counted !== null ? Money.subtract(counted, expected) : null;
  const over = variance !== null && Money.isPositive(variance);
  const short = variance !== null && Money.isNegative(variance);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Close the drawer"
      description="Count what is physically in the drawer, then enter the figure."
      width="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          {!revealed ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={counted === null}
              onClick={() => setRevealed(true)}
            >
              Check the count
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={counted === null || (short && !notes.trim())}
              onClick={async () => {
                if (counted !== null) await onConfirm(counted, notes.trim() || undefined);
                setInput("");
                setNotes("");
                setRevealed(false);
              }}
            >
              Close drawer
            </button>
          )}
        </>
      }
    >
      <label htmlFor="counted" className="eyebrow">
        Counted in drawer
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
        className="field num mt-1.5 text-right text-2xl font-semibold"
        placeholder="0.00"
      />

      {!revealed && (
        <p className="mt-3 text-[12px] text-zinc-500">
          The expected figure stays hidden until you have counted, so this is a
          count rather than a confirmation.
        </p>
      )}

      {revealed && variance !== null && (
        <div className="mt-4 space-y-2.5 rounded-lg bg-steel-800 p-4">
          <div className="flex justify-between text-[13px]">
            <span className="text-zinc-400">Expected</span>
            <span className="num">{amount(expected)}</span>
          </div>
          <div className="flex justify-between text-[13px]">
            <span className="text-zinc-400">Counted</span>
            <span className="num">{amount(counted!)}</span>
          </div>
          <div className="tear flex items-baseline justify-between pt-2.5">
            <span className="eyebrow">{short ? "Short" : over ? "Over" : "Balanced"}</span>
            <span
              className={`num text-xl font-bold ${
                short ? "text-signal-red" : over ? "text-signal-amber" : "text-signal-green"
              }`}
            >
              {amount(Money.abs(variance))}
            </span>
          </div>
        </div>
      )}

      {revealed && short && (
        <>
          <label htmlFor="variance-notes" className="eyebrow mt-4 block">
            Explain the shortfall
          </label>
          <input
            id="variance-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="field mt-1.5"
            placeholder="What happened?"
            autoFocus
          />
        </>
      )}
    </Dialog>
  );
}
