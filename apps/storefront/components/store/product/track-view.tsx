"use client";

import { useEffect } from "react";
import { recordView } from "@/lib/hooks/recently-viewed";
import type { SavedProduct } from "@/lib/hooks/local-list";

/** Renders nothing; remembers the product for the "Recently viewed" rows. */
export function TrackView({ product }: { product: SavedProduct }) {
  const { slug, name, brand, price, image } = product;
  useEffect(() => {
    recordView({ slug, name, brand, price, image });
    // The image object is a fresh reference every render; its URL is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, name, brand, price, image?.url]);
  return null;
}
