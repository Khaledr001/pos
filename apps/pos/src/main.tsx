import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./index.css";

/**
 * Theme initialisation — runs synchronously before the first paint.
 *
 * Reading from localStorage here (rather than inside a React effect) prevents
 * the flash of wrong theme that would otherwise appear on refresh. The
 * `data-theme` attribute set in index.html is the safe default; this replaces
 * it with the user's saved preference if one exists.
 */
export type PosTheme = "light" | "dark";
const THEME_KEY = "devsfleet.pos.theme";

export function applyTheme(theme: PosTheme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Full / disabled storage is not a reason to break.
  }
}

const savedTheme = localStorage.getItem(THEME_KEY) as PosTheme | null;
if (savedTheme === "light" || savedTheme === "dark") {
  document.documentElement.setAttribute("data-theme", savedTheme);
}

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from index.html");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

