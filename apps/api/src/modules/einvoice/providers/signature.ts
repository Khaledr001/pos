import { createHmac, timingSafeEqual } from "node:crypto";

/** `sha256=<hex>` of the raw bytes, keyed with the shared credential. */
export function sign(body: string | Buffer, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Constant-time check of a signature header against the raw body. A missing or malformed header is simply false. */
export function verifySignature(body: string | Buffer, header: string | undefined, secret: string): boolean {
  if (!header || !secret) return false;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(header.trim());
  return expected.length === given.length && timingSafeEqual(expected, given);
}
