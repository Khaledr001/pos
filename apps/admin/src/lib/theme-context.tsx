"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const THEME_KEY = "devsfleet_theme";

/**
 * The theme is applied to <html> by a blocking script in the root layout,
 * BEFORE React ever runs — see `THEME_BOOT_SCRIPT` below. This provider does
 * not decide the initial theme; it reads back what that script already
 * decided, so the two can never disagree.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  /**
   * Always "light" on the server and on first render.
   *
   * The real value is not knowable during SSR — it lives in the visitor's
   * localStorage — so guessing here would mean rendering one thing on the
   * server and another on the client. <html> carries suppressHydrationWarning
   * because the boot script mutates its class list before hydration; the
   * effect below then brings React's state into line.
   */
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    setThemeState(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      // Private mode or blocked storage: the theme still applies for this
      // session, it just will not be remembered. Not worth failing over.
    }
    document.documentElement.classList.toggle("dark", t === "dark");
  };

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Runs before first paint, from the document head.
 *
 * Without this the class was applied in an effect — after hydration — so
 * every page load flashed the light palette at a dark-mode user before
 * snapping to dark. Reading storage and the OS preference synchronously here
 * is the only way to have the right colours on the very first frame.
 *
 * Wrapped in try/catch because localStorage throws outright in some
 * lockdown/private modes, and an exception in a blocking head script takes
 * the whole page down with it.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  "devsfleet_theme",
)});if(t!=="dark"&&t!=="light"){t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.classList.toggle("dark",t==="dark");}catch(e){}})();`;

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
