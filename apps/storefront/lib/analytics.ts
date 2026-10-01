"use client";

/**
 * E-commerce events for GA4 and the Meta Pixel. Calls are no-ops until the
 * visitor accepts analytics cookies and the IDs are configured.
 */
type Item = { item_id: string; item_name: string; price: number; quantity: number };

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
  }
}

const META_EVENTS: Record<string, string> = {
  add_to_cart: "AddToCart",
  begin_checkout: "InitiateCheckout",
  purchase: "Purchase",
  view_item: "ViewContent",
};

export function track(event: "view_item" | "add_to_cart" | "begin_checkout" | "purchase", params: { value: number; items: Item[]; transaction_id?: string }) {
  if (typeof window === "undefined") return;
  const payload = { currency: "AED", ...params };
  window.gtag?.("event", event, payload);
  window.fbq?.("track", META_EVENTS[event], {
    currency: "AED",
    value: params.value,
    content_ids: params.items.map((i) => i.item_id),
    content_type: "product",
  });
}

export const CONSENT_KEY = "al_consent";
