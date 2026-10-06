"use client";

import { createLocalList, type SavedProduct } from "./local-list";

export const COMPARE_MAX = 4;
const list = createLocalList("compare");

export function useCompare() {
  const items = list.useList();
  return {
    items,
    has: (slug: string) => items.some((p) => p.slug === slug),
    full: items.length >= COMPARE_MAX,
    toggle(product: SavedProduct) {
      const current = list.snapshot();
      if (current.some((p) => p.slug === product.slug)) list.write(current.filter((p) => p.slug !== product.slug));
      else if (current.length < COMPARE_MAX) list.write([...current, product]);
    },
    remove(slug: string) {
      list.write(list.snapshot().filter((p) => p.slug !== slug));
    },
    clear() {
      list.write([]);
    },
  };
}
