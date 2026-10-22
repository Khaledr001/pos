import { Money } from "@devsfleet/shared-utils";

export type CountStatus = "draft" | "counting" | "pending_approval" | "approved" | "cancelled";

export const STATUS_LABEL: Record<CountStatus, string> = {
  draft: "Draft",
  counting: "Counting",
  pending_approval: "Awaiting approval",
  approved: "Approved",
  cancelled: "Cancelled",
};

export const STATUS_VARIANT: Record<CountStatus, "secondary" | "warning" | "success" | "destructive" | "default"> = {
  draft: "secondary",
  counting: "default",
  pending_approval: "warning",
  approved: "success",
  cancelled: "secondary",
};

/** Counts can still be entered while the sheet is draft or counting — the API's own rule. */
export const isEditable = (status: CountStatus) => status === "draft" || status === "counting";

/**
 * "12.5000" → "12.5", "-3.0000" → "-3". Done on the string: the API sends
 * quantities as four-place decimals, and a round trip through a float would
 * be the one place on this page a 0.1 could turn into 0.09999.
 */
export function trimQty(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (!value.includes(".")) return value;
  const trimmed = value.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "-0" ? "0" : trimmed;
}

/** Variance as the approver reads it: a sign on every non-zero figure. */
export function signedQty(value: string | null | undefined): string {
  const t = trimQty(value);
  if (t === "—" || t === "0" || t.startsWith("-")) return t;
  return `+${t}`;
}

export function varianceTone(value: string | null | undefined): string {
  if (!value) return "text-muted-foreground";
  const minor = Money.toMinor(value);
  if (minor === 0n) return "text-muted-foreground";
  return minor < 0n
    ? "text-destructive"
    : "text-emerald-600 dark:text-emerald-400";
}

/** Variance × average cost, or null when either is unknown. */
export function varianceValue(variance: string | null | undefined, unitCost: string | null | undefined) {
  if (!variance || !unitCost) return null;
  return Money.multiplyByQuantity(Money.toMinor(unitCost), variance);
}

/**
 * What the counter typed, if it is a count the API will take: digits with up
 * to four decimals, zero allowed. Anything else is not saved, rather than
 * saved as something it did not say.
 */
export function parseCount(raw: string): string | null {
  const value = raw.trim();
  if (!/^\d+(\.\d{1,4})?$/.test(value)) return null;
  return value;
}
