/**
 * The function-key rail.
 *
 * A permanent strip across the bottom of every screen showing what each key
 * does right now. It is the signature of this interface, and it is not
 * decoration: a till is a keyboard machine, cashiers learn keys rather than
 * menus, and the fastest operator in the shop should never have to look for a
 * button.
 *
 * It doubles as a touch target, so the same action works on a touchscreen with
 * no keyboard attached. One control, two input methods, one label.
 *
 * Keeping it visible also teaches: a new cashier who clicks the rail for a week
 * has read the shortcut a hundred times by the end of it.
 */
export interface KeyAction {
  /** Displayed exactly as it is on the keyboard: F4, Esc, Ctrl+P. */
  combo: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** The one action that completes the transaction. At most one per screen. */
  primary?: boolean;
  tone?: "default" | "danger";
}

export function KeyRail({ actions }: { actions: KeyAction[] }) {
  return (
    <nav
      aria-label="Keyboard shortcuts"
      className="flex shrink-0 items-stretch gap-px border-t border-pos-border bg-pos-panel"
    >
      {actions.map((action) => (
        <button
          key={action.combo}
          type="button"
          onClick={action.onPress}
          disabled={action.disabled}
          className={[
            "group flex flex-1 items-center justify-center gap-2.5 px-3 py-2.5",
            "text-left transition-colors",
            action.disabled
              ? "cursor-not-allowed opacity-35"
              : action.primary
                ? "bg-brass/12 hover:bg-brass/20"
                : "hover:bg-pos-raised",
          ].join(" ")}
        >
          <kbd
            className={[
              "num rounded px-1.5 py-1 text-[11px] font-semibold leading-none",
              action.disabled
                ? "bg-pos-raised text-pos-text-3"
                : action.primary
                  ? "bg-brass text-[#1a1205]"
                  : action.tone === "danger"
                    ? "bg-signal-red/20 text-signal-red"
                    : "bg-pos-border text-pos-text-2",
            ].join(" ")}
          >
            {action.combo}
          </kbd>
          <span
            className={[
              "truncate text-[12px] font-medium",
              action.primary ? "text-brass" : "text-pos-text-2",
              action.tone === "danger" && !action.primary ? "text-signal-red" : "",
            ].join(" ")}
          >
            {action.label}
          </span>
        </button>
      ))}
    </nav>
  );
}
