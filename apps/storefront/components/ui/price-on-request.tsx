"use client";

import { useSite } from "@/lib/store-config";

/** What stands where a price would: an invitation to ask, on a site that sells by enquiry. */
export function PriceOnRequest({ className }: { className?: string }) {
  const { features } = useSite();
  return <span className={className ?? "text-sm text-steel"}>{features.enquiries ? "Enquire for price" : "Price on request"}</span>;
}
