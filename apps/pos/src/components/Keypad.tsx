import { Delete } from "lucide-react";

/**
 * Numeric keypad.
 *
 * Present because a shop touchscreen frequently has no keyboard attached, and
 * because entering a PIN or a cash amount on an on-screen QWERTY is slow and
 * error-prone. Keys are sized for a fingertip on a resistive panel, which is
 * larger than the 44px accessibility floor.
 *
 * Physical number keys stay bound wherever this appears, so a terminal WITH a
 * keyboard is never slower for having the pad on screen.
 */
export function Keypad({
  onDigit,
  onBackspace,
  onClear,
  showDecimal = false,
  disabled = false,
}: {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  showDecimal?: boolean;
  disabled?: boolean;
}) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((key) => (
        <KeypadKey key={key} onPress={() => onDigit(key)} disabled={disabled}>
          {key}
        </KeypadKey>
      ))}

      {showDecimal ? (
        <KeypadKey onPress={() => onDigit(".")} disabled={disabled}>
          .
        </KeypadKey>
      ) : (
        <KeypadKey onPress={onClear} disabled={disabled} tone="muted">
          <span className="text-[13px] font-semibold tracking-wide">CLR</span>
        </KeypadKey>
      )}

      <KeypadKey onPress={() => onDigit("0")} disabled={disabled}>
        0
      </KeypadKey>

      <KeypadKey onPress={onBackspace} disabled={disabled} tone="muted">
        <Delete className="size-5" aria-hidden />
        <span className="sr-only">Backspace</span>
      </KeypadKey>
    </div>
  );
}

function KeypadKey({
  children,
  onPress,
  disabled,
  tone = "default",
}: {
  children: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  tone?: "default" | "muted";
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      // `tabIndex={-1}` on purpose: the pad is for touch. Keeping it out of the
      // tab order means a keyboard user tabs straight from the amount field to
      // the confirm button instead of through twelve keys.
      tabIndex={-1}
      className={[
        "num flex h-14 items-center justify-center rounded-lg border text-xl font-semibold",
        "transition-colors active:scale-[0.97]",
        tone === "muted"
          ? "border-steel-700 bg-steel-850 text-zinc-400 hover:bg-steel-800"
          : "border-steel-700 bg-steel-800 text-chalk hover:bg-steel-750",
        disabled ? "pointer-events-none opacity-40" : "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
