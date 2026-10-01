"use client";

import type { OrderView } from "@al-lahiq/api-client";
import { useEffect } from "react";
import { track } from "@/lib/analytics";

/** Sends the purchase event once per order (reloads don't double count). */
export function PurchaseEvent({ order }: { order: OrderView }) {
  useEffect(() => {
    const key = `al_tracked_${order.orderNumber}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // storage blocked: still send once for this view
    }
    track("purchase", {
      transaction_id: order.orderNumber,
      value: order.totals.total.fils / 100,
      items: order.lines.map((l) => ({ item_id: l.sku, item_name: l.name, price: l.unitPrice.fils / 100, quantity: l.quantity })),
    });
  }, [order]);
  return null;
}
