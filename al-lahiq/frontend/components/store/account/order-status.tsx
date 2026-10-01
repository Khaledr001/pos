import type { OrderStatus } from "@al-lahiq/api-client";
import { Badge } from "@/components/ui/badge";
import { ORDER_STATUS } from "@/lib/format";

const TONE: Record<OrderStatus, "neutral" | "pipe" | "brass" | "signal" | "ink"> = {
  PENDING_PAYMENT: "brass",
  PLACED: "neutral",
  CONFIRMED: "neutral",
  PACKED: "neutral",
  SHIPPED: "neutral",
  READY_FOR_PICKUP: "brass",
  DELIVERED: "pipe",
  COLLECTED: "pipe",
  CANCELLED: "signal",
  REFUNDED: "neutral",
};

export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <Badge tone={TONE[status]} className={className}>
      {ORDER_STATUS[status]}
    </Badge>
  );
}
