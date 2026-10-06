/** Case/space/punctuation-insensitive key for joining names across systems. */
export function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
