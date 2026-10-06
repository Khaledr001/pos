import type { QuoteStatus } from "@devsfleet/storefront-client";
import { Badge } from "@/components/ui/badge";

export const QUOTE_STATUS: Record<QuoteStatus, string> = {
  REQUESTED: "Awaiting our price",
  QUOTED: "Quoted",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  EXPIRED: "Expired",
  CONVERTED: "Ordered",
};

const TONE: Record<QuoteStatus, "neutral" | "pipe" | "brass" | "signal" | "ink"> = {
  REQUESTED: "neutral",
  QUOTED: "brass",
  ACCEPTED: "pipe",
  DECLINED: "signal",
  EXPIRED: "neutral",
  CONVERTED: "pipe",
};

export function QuoteStatusBadge({ status, className }: { status: QuoteStatus; className?: string }) {
  return (
    <Badge tone={TONE[status]} className={className}>
      {QUOTE_STATUS[status]}
    </Badge>
  );
}
