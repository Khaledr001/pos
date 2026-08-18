import { useEffect, useRef } from "react";
import { useAuth } from "../store/auth.js";

/**
 * Global inactivity tracker.
 *
 * A till left unattended signed in as a manager is a security hole. This hook
 * tracks DOM activity and clears the active cashier if idle for the configured
 * duration.
 *
 * It does NOT clear the terminal binding — the terminal is still registered, it
 * just drops back to the PIN login screen.
 */
export function useIdleTimer(timeoutMinutes = 5) {
  const signOut = useAuth((s) => s.signOut);
  const timeoutId = useRef<number | null>(null);

  useEffect(() => {
    const ms = timeoutMinutes * 60 * 1000;

    const reset = () => {
      if (timeoutId.current !== null) {
        window.clearTimeout(timeoutId.current);
      }
      timeoutId.current = window.setTimeout(() => {
        signOut();
      }, ms);
    };

    // Initialise
    reset();

    // Listeners
    const events = ["mousedown", "mousemove", "keydown", "scroll", "touchstart"];
    for (const event of events) {
      window.addEventListener(event, reset, { passive: true });
    }

    return () => {
      if (timeoutId.current !== null) window.clearTimeout(timeoutId.current);
      for (const event of events) {
        window.removeEventListener(event, reset);
      }
    };
  }, [timeoutMinutes, signOut]);
}
