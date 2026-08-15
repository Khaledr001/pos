/**
 * Text normalisation shared by product search, the Excel importer, and the
 * WhatsApp AI's entity matching.
 *
 * The catalogue is hardware/electrical/sanitary stock, which means the same
 * item shows up as `1" Elbow`, `1 inch elbow`, `1in elbow` and `25mm elbow`
 * depending on who typed it. Normalising consistently in one place is the
 * difference between the bot finding the product and escalating to a human.
 */

/** Lowercase, strip accents, collapse whitespace. The baseline for any comparison. */
export function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** URL-safe slug. Used for tenant slugs and category paths. */
export function slugify(value: string): string {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

/**
 * Canonicalise the imperial/metric size notation that dominates this catalogue.
 * `3/4"`, `3/4 inch`, `0.75in` all become `3/4in` so search and dedup agree.
 */
export function normalizeMeasurement(value: string): string {
  return normalize(value)
    .replace(/(\d)\s*["″]/g, "$1in")
    .replace(/(\d)\s*(?:inches|inch|")/g, "$1in")
    .replace(/(\d)\s*(?:millimet(?:er|re)s?|mm)\b/g, "$1mm")
    .replace(/(\d)\s*(?:centimet(?:er|re)s?|cm)\b/g, "$1cm")
    .replace(/(\d)\s*(?:met(?:er|re)s?|mtr|m)\b/g, "$1m")
    .replace(/(\d)\s*(?:kilograms?|kgs?)\b/g, "$1kg")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Search key for a product: normalised, measurements canonicalised, and
 * punctuation reduced to single spaces. Stored alongside the product so a
 * trigram index can be built on it.
 */
export function searchKey(...parts: Array<string | null | undefined>): string {
  return normalizeMeasurement(parts.filter(Boolean).join(" "))
    .replace(/[^\p{L}\p{N}/.]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Barcode normalisation. Scanners emit leading zeros inconsistently and some
 * append a carriage return. UPC-A is EAN-13 with a leading zero, so both forms
 * must resolve to the same product.
 */
export function normalizeBarcode(value: string): string {
  const digits = value.trim().replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  // UPC-A (12) widened to EAN-13 so a single lookup finds either encoding.
  if (/^\d{12}$/.test(digits)) return `0${digits}`;
  return digits;
}

/**
 * E.164 phone normalisation, used to match a WhatsApp sender to a customer row.
 * Defaults to the UAE country code for bare local numbers like 0501234567.
 */
export function normalizePhone(value: string, defaultCountryCode = "971"): string | null {
  const digits = value.replace(/[^\d+]/g, "");
  if (digits === "") return null;

  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("0")) return `+${defaultCountryCode}${digits.slice(1)}`;
  if (digits.startsWith(defaultCountryCode)) return `+${digits}`;

  return `+${defaultCountryCode}${digits}`;
}

/** Truncate for a thermal receipt line without splitting a grapheme. */
export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}
