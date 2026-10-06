"use client";

import { createLocalList, type SavedProduct } from "./local-list";

const MAX = 12;
const list = createLocalList("recently-viewed");

export function useRecentlyViewed() {
  return list.useList();
}

/** Most recent first; viewing a product again moves it to the front instead of duplicating it. */
export function recordView(product: SavedProduct) {
  const rest = list.snapshot().filter((p) => p.slug !== product.slug);
  list.write([product, ...rest].slice(0, MAX));
}
