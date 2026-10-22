import { Money } from "@devsfleet/shared-utils";

/** "Just now", "3m ago", "2h ago", "5d ago". */
export function timeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * A money string from the API, grouped for reading: "12500.5" → "12,500.50".
 *
 * Goes through `Money` rather than `parseFloat`, which is how a table ended up
 * printing a credit limit as 0.30000000000000004. Empty becomes an em dash; a
 * value that is not a number at all is shown as it came, rather than hidden.
 */
export function formatMoney(
  value: string | number | null | undefined,
  options: { currency?: string; decimals?: number } = {},
): string {
  if (value === null || value === undefined || value === "") return "—";
  const { currency, decimals = 2 } = options;
  let plain: string;
  try {
    plain = Money.toDecimalString(Money.toMinor(value), decimals);
  } catch {
    return String(value);
  }
  const negative = plain.startsWith("-");
  const [whole = "0", frac] = (negative ? plain.slice(1) : plain).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const amount = `${negative ? "-" : ""}${grouped}${frac ? `.${frac}` : ""}`;
  return currency ? `${currency} ${amount}` : amount;
}
