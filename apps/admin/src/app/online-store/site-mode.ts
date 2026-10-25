"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { SiteMode, StorefrontSettings } from "@devsfleet/shared-types";
import { api } from "@/lib/api-client";

const CACHE_KEY = "devsfleet_site_mode";
const MODES: readonly string[] = ["shop", "catalogue", "showcase"];

/**
 * The tenant's site mode, shared by everything that adapts to it (the sidebar,
 * the Online Store tabs). Kept outside React state so a screen that changes the
 * mode updates the sidebar at once, and cached for the browser session so a
 * reload does not briefly show every shop-only screen to a showcase site.
 *
 * `null` means "not known yet" and callers must then show everything: hiding
 * on a loading state would make navigation flicker.
 */
let current: SiteMode | null | undefined;
let requested = false;
const listeners = new Set<() => void>();

function read(): SiteMode | null {
  if (current !== undefined) return current;
  try {
    const stored = sessionStorage.getItem(CACHE_KEY);
    current = stored && MODES.includes(stored) ? (stored as SiteMode) : null;
  } catch {
    current = null;
  }
  return current;
}

export function setKnownSiteMode(mode: SiteMode | null): void {
  current = mode;
  try {
    if (mode) sessionStorage.setItem(CACHE_KEY, mode);
    else sessionStorage.removeItem(CACHE_KEY);
  } catch {
    // Storage can be blocked; the in-memory value still works.
  }
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** `enabled` is false for someone who may not read the store; they never trigger the fetch. */
export function useSiteMode(enabled: boolean): SiteMode | null {
  const mode = useSyncExternalStore(subscribe, read, () => null);
  useEffect(() => {
    if (!enabled || requested) return;
    requested = true;
    api
      .get<{ settings?: StorefrontSettings }>("/storefront-admin/settings")
      .then((o) => setKnownSiteMode(o.settings?.site.mode ?? null))
      .catch(() => {
        // Not fatal and worth another try on the next screen.
        requested = false;
      });
  }, [enabled]);
  return mode;
}

/** Screens that only make sense when visitors can buy. */
const SHOP_ONLY = ["/online-store/orders", "/online-store/coupons", "/online-store/quotes", "/online-store/stock-alerts", "/online-store/trade"];
/** Screens that only make sense when the site has products. */
const PRODUCT_ONLY = ["/online-store/listings"];

export function isStoreScreenVisible(href: string, mode: SiteMode | null): boolean {
  if (mode === null || mode === "shop") return true;
  if (SHOP_ONLY.includes(href)) return false;
  if (mode === "showcase" && PRODUCT_ONLY.includes(href)) return false;
  return true;
}
