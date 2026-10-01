import { notFound } from "next/navigation";

/**
 * Unmatched store URLs render the store's not-found page (with header,
 * footer and search) instead of the bare default 404.
 */
export default function MissingPage() {
  notFound();
}
