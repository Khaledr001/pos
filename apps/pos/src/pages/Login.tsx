import { Loader2, Store } from "lucide-react";
import { useState } from "react";
import { Keypad } from "../components/Keypad.js";
import { useHotkeys } from "../lib/keyboard.js";
import { posData } from "../lib/pos-data.js";
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
  const { terminal, signIn, bindTerminal } = useAuth();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

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
    <div className="flex h-full items-center justify-center bg-steel-900 p-6">
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

        <p className="mt-5 text-center text-[11px] leading-relaxed text-zinc-600">
          Development PINs — 1234 admin · 2222 cashier · 3333 manager
        </p>
      </div>
    </div>
  );
}
