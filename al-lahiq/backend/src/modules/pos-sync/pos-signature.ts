import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Both directions use the same scheme:
 *   X-AL-Timestamp: unix seconds
 *   X-AL-Signature: sha256=<hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`)>
 * Binding the timestamp into the signature blocks replay of old requests.
 */
export const SIGNATURE_HEADER = 'x-al-signature';
export const TIMESTAMP_HEADER = 'x-al-timestamp';

export function sign(secret: string, timestamp: number, body: string | Buffer): string {
  const mac = createHmac('sha256', secret);
  mac.update(`${timestamp}.`);
  mac.update(body);
  return `sha256=${mac.digest('hex')}`;
}

export function verifySignature(
  secret: string,
  timestamp: string | undefined,
  signature: string | undefined,
  body: Buffer,
  toleranceSeconds: number,
  now = Date.now(),
): boolean {
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  const ts = Number(timestamp);
  if (Math.abs(now / 1000 - ts) > toleranceSeconds) return false;
  const expected = Buffer.from(sign(secret, ts, body));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
