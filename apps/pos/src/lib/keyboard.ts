import { useEffect, useRef } from "react";

/**
 * Keyboard is the primary input on a till. A cashier who has to reach for a
 * mouse between every sale is a slower queue.
 */

type Handler = (event: KeyboardEvent) => void;

/**
 * Bind function keys and shortcuts.
 *
 * Bindings stay live while the cashier is typing in the search box — F4 must
 * charge the sale whether or not focus happens to be in a field. Plain
 * character keys are the exception and are ignored while typing, or searching
 * for "Elbow" would fire four shortcuts.
 */
export function useHotkeys(bindings: Record<string, Handler>, enabled = true): void {
  const ref = useRef(bindings);
  ref.current = bindings;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;

      const parts: string[] = [];
      if (event.ctrlKey) parts.push("ctrl");
      if (event.altKey) parts.push("alt");
      if (event.shiftKey && event.key.length > 1) parts.push("shift");
      parts.push(event.key.toLowerCase());
      const combo = parts.join("+");

      const handler = ref.current[combo];
      if (!handler) return;

      // Function keys, Escape and modifier combos always fire. A bare letter
      // does not, or typing a product name would trigger shortcuts.
      const isReserved =
        /^f\d{1,2}$/.test(event.key.toLowerCase()) ||
        event.key === "Escape" ||
        event.ctrlKey ||
        event.altKey;

      if (typing && !isReserved) return;

      event.preventDefault();
      handler(event);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

/**
 * USB HID barcode scanners emulate a keyboard: they "type" the code and press
 * Enter, far faster than a human can. Detecting that speed is what separates a
 * scan from someone typing a SKU by hand.
 *
 * The threshold is per-keystroke, not per-scan, because a long EAN-13 typed by
 * a scanner still arrives with ~10-30ms between characters while a fast typist
 * manages ~80ms at best.
 *
 * `onScan` fires on Enter with the accumulated buffer. Nothing is echoed into
 * the focused field, so a scan works no matter where focus is.
 */
export function useBarcodeScanner(
  onScan: (barcode: string) => void,
  options: { minLength?: number; maxIntervalMs?: number; enabled?: boolean } = {},
): void {
  const { minLength = 4, maxIntervalMs = 50, enabled = true } = options;
  const callback = useRef(onScan);
  callback.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    let buffer = "";
    let lastAt = 0;

    const onKeyDown = (event: KeyboardEvent) => {
      const now = performance.now();

      if (event.key === "Enter") {
        if (buffer.length >= minLength) {
          // Only claim the Enter if this really was a scan; otherwise let the
          // form submit as the cashier intended.
          event.preventDefault();
          callback.current(buffer);
        }
        buffer = "";
        return;
      }

      // Anything but a single printable character ends the burst.
      if (event.key.length !== 1) {
        buffer = "";
        return;
      }

      if (now - lastAt > maxIntervalMs) buffer = "";
      buffer += event.key;
      lastAt = now;
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [minLength, maxIntervalMs, enabled]);
}

/** Focus an element on mount — the search box, the keypad, the amount field. */
export function useAutoFocus<T extends HTMLElement>(enabled = true) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (enabled) ref.current?.focus();
  }, [enabled]);
  return ref;
}
