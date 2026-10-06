"use client";

import { useSyncExternalStore } from "react";

/** The few fields needed to draw a product tile without asking the API again. */
export interface SavedProduct {
  slug: string;
  name: string;
  brand: string | null;
  image: { url: string; alt: string } | null;
  /** Already formatted by the API ("AED 12.50"); never re-derived from a float. */
  price: string | null;
}

function isSavedProduct(v: unknown): v is SavedProduct {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  const img = o.image as Record<string, unknown> | null | undefined;
  return (
    typeof o.slug === "string" &&
    typeof o.name === "string" &&
    (o.brand == null || typeof o.brand === "string") &&
    (o.price == null || typeof o.price === "string") &&
    (img == null || (typeof img.url === "string" && typeof img.alt === "string"))
  );
}

const EMPTY: readonly SavedProduct[] = [];

/**
 * A localStorage-backed list shared by every component that uses it, so a
 * "Compare" button in a card and the tray update together. Every storage
 * access is guarded: private windows and blocked site data throw, and the
 * list then simply lives in memory for the session.
 */
export function createLocalList(key: string) {
  let cache: readonly SavedProduct[] | null = null;
  const listeners = new Set<() => void>();

  function read(): readonly SavedProduct[] {
    try {
      const raw = window.localStorage.getItem(key);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      // A hand-edited or older-format entry is dropped rather than trusted.
      return Array.isArray(parsed) ? parsed.filter(isSavedProduct) : EMPTY;
    } catch {
      return EMPTY;
    }
  }

  function snapshot() {
    return (cache ??= read());
  }

  function write(next: readonly SavedProduct[]) {
    cache = next;
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Quota or blocked storage: keep the in-memory copy.
    }
    listeners.forEach((l) => l());
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key && e.key !== null) return;
      cache = null;
      listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }

  function useList(): readonly SavedProduct[] {
    return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  }

  return { useList, snapshot, write };
}
