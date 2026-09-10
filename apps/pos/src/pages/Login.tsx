import { Loader2, LogOut, Store } from "lucide-react";
import { useState } from "react";
import { Keypad } from "../components/Keypad.js";
import { useHotkeys } from "../lib/keyboard.js";
import { hasBridge, posData } from "../lib/pos-data.js";
import { useAuth } from "../store/auth.js";

/**
 * Counter sign-in.
 *
 * A PIN, not a password. Cashiers hand the till over to each other several
 * times a shift, and a 12-character password typed on a touchscreen between
 * every customer is a rule that gets worked around — usually by never signing
 * out at all, which is worse than a short PIN.
 *
 * The PIN is only weak in isolation. The server accepts it solely alongside a
 * registered device id and a branch, so it is not a credential that works from
 * anywhere; see `pinLogin` in the API's auth service.
 */

const PIN_LENGTH = 4;

export function Login() {
  const { terminal, signIn, bindTerminal, unbindTerminal } = useAuth();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [unpairing, setUnpairing] = useState(false);
  const [unpairError, setUnpairError] = useState<string | null>(null);
  /** Set when unpair was refused for unsynced work — how many items are at stake. */
  const [blockedCount, setBlockedCount] = useState<number | null>(null);
  const [discardConfirm, setDiscardConfirm] = useState("");

  /**
   * Disconnect the till from its business, from the one screen you can always
   * reach.
   *
   * The same action exists in Settings, but Settings is behind a PIN, and a
   * PIN is exactly what you cannot get past when the till is bound to the
   * wrong tenant or to a server that no longer answers — the terminal is
   * then unrecoverable from its own UI.
   *
   * Deliberately NOT gated on a permission the way the Settings copy is:
   * there is no signed-in cashier here to hold one, and gating it on the
   * server would fail precisely when the server is unreachable, which is the
   * main reason to be here. The guard that actually matters is in the main
   * process — `device:unpair` refuses while the outbox holds anything
   * unsynced, so this can never cost a day's takings. The worst it can cost
   * is a re-pairing.
   */
  async function handleUnpair(force = false) {
    setUnpairError(null);

    if (!force) {
      const business = terminal?.tenantName ?? "its current business";
      const confirmed = confirm(
        `Sign this terminal out of ${business}?\n\n` +
          "It will need to be registered again before it can sell, and every " +
          "product, price, customer and staff PIN cached here is wiped. " +
          "Unpairing is refused if any sale has not synced yet.",
      );
      if (!confirmed) return;
    }

    setUnpairing(true);
    try {
      await window.devsfleet.device.unpair(force);
      unbindTerminal();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to sign out of this business.";
      setUnpairError(message);

      /**
       * Turn the refusal into a decision rather than a wall.
       *
       * Draining the outbox needs a signed-in session, which is exactly what
       * is missing when someone is unpairing from the PIN screen — so
       * "sync first" is advice the operator often cannot act on. Offer the
       * discard explicitly, with the count named and a word to type, instead
       * of leaving the terminal stuck.
       */
      const unsynced = /^(\d+) sale\(s\) have not synced/.exec(message);
      setBlockedCount(unsynced ? Number(unsynced[1]) : null);
      setDiscardConfirm("");
    } finally {
      setUnpairing(false);
    }
  }

  /**
   * The PIN is verified by the server, never here.
   *
   * That makes a shift change the one counter action that needs connectivity —
   * accepted deliberately, because the alternative is holding something
   * PIN-equivalent on a machine that sits unattended in a shop.
   */
  async function submit(candidate: string) {
    setChecking(true);
    setError(null);

    try {
      const cashier = await posData.signIn(candidate);
      signIn({
        id: cashier.id,
        name: cashier.name,
        roleName: cashier.roleName,
        permissions: cashier.permissions,
        // Without this every PIN sign-in read as a 0% ceiling regardless of
        // the cashier's real one, since the store falls back to "0" when it
        // is absent — a discount ceiling of 0% asks for a manager on every
        // single discount, not just the ones that are actually over the line.
        maxDiscountPercent: cashier.maxDiscountPercent,
      });

      // The server decides which branch this terminal sells against — a PIN
      // login is pinned to the device's branch, whatever the cashier's own
      // access would otherwise allow.
      if (cashier.branchId) {
        bindTerminal({
          ...terminal!,
          branchId: cashier.branchId,
          branchName: cashier.branchName ?? terminal?.branchName ?? "",
          tenantName: cashier.tenantName ?? terminal?.tenantName ?? "",
        });
      }
    } catch (error) {
      setError(
        error instanceof Error && error.message
          ? error.message
          : "That PIN was not recognised. Try again.",
      );
      setPin("");
    } finally {
      setChecking(false);
    }
  }

  function push(digit: string) {
    if (checking) return;
    setError(null);
    const next = (pin + digit).slice(0, PIN_LENGTH);
    setPin(next);
    if (next.length === PIN_LENGTH) void submit(next);
  }

  useHotkeys({
    ...Object.fromEntries(
      Array.from({ length: 10 }, (_, n) => [String(n), () => push(String(n))]),
    ),
    backspace: () => setPin((p) => p.slice(0, -1)),
    escape: () => setPin(""),
  });

  return (
    // Forced dark regardless of the app's saved light/dark preference — see
    // the identical comment in RegisterTerminal.tsx. This screen's `.panel`
    // reads the theme-aware --pos-* tokens, which default to light until a
    // cashier changes it in Settings, while the page background here is
    // unconditionally dark.
    <div data-theme="dark" className="flex h-full items-center justify-center bg-steel-900 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-brass/12">
            <Store className="size-6 text-brass" aria-hidden />
          </div>
          <h1 className="text-lg font-semibold">{terminal?.tenantName}</h1>
          <p className="num mt-1 text-[12px] text-zinc-500">
            {terminal?.branchName} · {terminal?.deviceName}
          </p>
        </div>

        <div className="panel p-6">
          <p className="mb-4 text-center text-[13px] text-zinc-400">
            Enter your PIN to start a shift
          </p>

          {/* Filled pips rather than a text field: it reads at arm's length and
              a shoulder-surfer learns only the length. */}
          <div
            className="mb-5 flex justify-center gap-3"
            role="status"
            aria-label={`${pin.length} of ${PIN_LENGTH} digits entered`}
          >
            {Array.from({ length: PIN_LENGTH }, (_, i) => (
              <span
                key={i}
                className={[
                  "size-3.5 rounded-full border transition-colors",
                  i < pin.length
                    ? "border-brass bg-brass"
                    : "border-steel-700 bg-steel-800",
                ].join(" ")}
              />
            ))}
          </div>

          <div className="mb-4 flex h-5 items-center justify-center">
            {checking && <Loader2 className="size-4 animate-spin text-zinc-500" />}
            {error && (
              <p role="alert" className="text-[12px] text-signal-red">
                {error}
              </p>
            )}
          </div>

          <Keypad
            onDigit={push}
            onBackspace={() => setPin((p) => p.slice(0, -1))}
            onClear={() => setPin("")}
            disabled={checking}
          />
        </div>

        {/* Kept in step with packages/db/scripts/seed.ts (SEED_*_PIN). The
            previous values here — 1234 admin, 2222 cashier, 3333 manager —
            matched nothing the seed has ever created, so two of the three
            simply returned "Incorrect PIN". */}
        <p className="mt-5 text-center text-[11px] leading-relaxed text-zinc-600">
          Development PINs — 1234 cashier · 2580 manager · 4321 admin
        </p>

        {/* Electron only: device.unpair is IPC, and there is nothing to unpair
            in browser preview mode. */}
        {hasBridge() && (
          <div className="mt-6 border-t border-steel-800 pt-4 text-center">
            {unpairError && (
              <p role="alert" className="mb-2 text-[11px] text-signal-red">
                {unpairError}
              </p>
            )}

            {blockedCount !== null && (
              <div className="mb-3 rounded-lg border border-signal-red/40 bg-signal-red/5 p-3 text-left">
                <p className="text-[11px] leading-relaxed text-zinc-300">
                  Nothing can drain that queue without a sign-in, so if you cannot get past
                  the PIN screen, the only way forward is to discard it.{" "}
                  <strong className="text-signal-red">
                    {blockedCount} unsynced item{blockedCount === 1 ? "" : "s"} will be lost
                    permanently.
                  </strong>
                </p>
                <label className="mt-2.5 block text-[10px] uppercase tracking-wider text-zinc-500">
                  Type DISCARD to confirm
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    autoFocus
                    value={discardConfirm}
                    onChange={(e) => setDiscardConfirm(e.target.value)}
                    className="field flex-1 text-[12px]"
                    placeholder="DISCARD"
                  />
                  <button
                    type="button"
                    disabled={discardConfirm !== "DISCARD" || unpairing}
                    onClick={() => void handleUnpair(true)}
                    className="btn btn-danger px-3 text-[11px]"
                  >
                    Discard &amp; sign out
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setBlockedCount(null);
                    setUnpairError(null);
                    setDiscardConfirm("");
                  }}
                  className="mt-2 text-[10px] text-zinc-600 hover:text-zinc-400"
                >
                  Cancel
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => void handleUnpair()}
              disabled={unpairing}
              className="inline-flex items-center gap-1.5 text-[11px] text-zinc-600 transition-colors hover:text-signal-red disabled:cursor-not-allowed disabled:opacity-50"
            >
              {unpairing ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <LogOut className="size-3" />
              )}
              {unpairing
                ? "Signing out…"
                : `Sign out of ${terminal?.tenantName ?? "this business"}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
