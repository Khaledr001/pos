import { EINVOICE_STATUS_LABELS, type EinvoiceStatus } from "@devsfleet/shared-types";
import { Badge } from "@/components/ui/badge";
import { EINVOICE_STATUS_TONE } from "@/lib/einvoice";
import { cn } from "@/lib/utils";

/** One badge for a document's e-invoice state, the same on every screen that shows it. */
export function EinvoiceStatusBadge({ status, className }: { status: EinvoiceStatus; className?: string }) {
  return (
    <Badge variant={EINVOICE_STATUS_TONE[status] ?? "secondary"} className={cn("whitespace-nowrap", className)}>
      {EINVOICE_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}
