import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The token behind a shared statement link.
 *
 * Stateless and signed: nothing is stored when a link is made, and the link
 * is checked by recomputing its signature. Packed into bytes rather than a
 * JWT because it travels inside a WhatsApp message — a JWT carrying the same
 * claims is three times longer and wraps across several lines of the chat.
 *
 *   version      1 byte
 *   tenant id   16 bytes
 *   customer id 16 bytes
 *   from         4 bytes  days since 1970-01-01, or NONE
 *   to           4 bytes  days since 1970-01-01, or NONE
 *   expires      4 bytes  seconds since epoch
 *   branches     1 byte count, then 16 bytes each (0 = every branch)
 *   signature   16 bytes  HMAC-SHA256, truncated
 *
 * The branches are the SHARER'S scope. A manager limited to one shop must not
 * be able to hand out a link that shows the customer's dealings everywhere.
 */

export interface StatementLinkClaims {
  tenantId: string;
  customerId: string;
  /** YYYY-MM-DD, inclusive. Null = from the first document. */
  from: string | null;
  /** YYYY-MM-DD, inclusive. Null = up to now. */
  to: string | null;
  expiresAt: Date;
  /** Null = every branch. */
  branchIds: string[] | null;
}

export type StatementLinkCheck =
  | { ok: true; claims: StatementLinkClaims }
  | { ok: false; reason: "invalid" | "expired" };

const VERSION = 1;
const NONE = 0xffffffff;
const SIGNATURE_BYTES = 16;
const FIXED_BYTES = 1 + 16 + 16 + 4 + 4 + 4 + 1;
const MAX_BRANCHES = 255;
const DAY_MS = 86_400_000;

/**
 * Its own key, derived from the access-token secret under a purpose label —
 * so the VPS needs no new variable, and a statement token can never verify as
 * anything else, nor anything else as a statement token.
 */
export function statementLinkKey(accessSecret: string): Buffer {
  return createHmac("sha256", accessSecret).update("devsfleet:customer-statement-link:v1").digest();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidToBytes(id: string): Buffer {
  if (!UUID.test(id)) throw new Error(`not a uuid: ${id}`);
  return Buffer.from(id.replace(/-/g, ""), "hex");
}

function bytesToUuid(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function dayNumber(date: string | null): number {
  if (!date) return NONE;
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms)) throw new Error(`not a date: ${date}`);
  return Math.floor(ms / DAY_MS);
}

function dayString(n: number): string | null {
  return n === NONE ? null : new Date(n * DAY_MS).toISOString().slice(0, 10);
}

function sign(key: Buffer, payload: Buffer): Buffer {
  return createHmac("sha256", key).update(payload).digest().subarray(0, SIGNATURE_BYTES);
}

export function createStatementLinkToken(key: Buffer, claims: StatementLinkClaims): string {
  const branches = claims.branchIds ?? [];
  if (branches.length > MAX_BRANCHES) throw new Error("too many branches for one link");

  const payload = Buffer.alloc(FIXED_BYTES + branches.length * 16);
  let at = 0;
  payload.writeUInt8(VERSION, at);
  at += 1;
  uuidToBytes(claims.tenantId).copy(payload, at);
  at += 16;
  uuidToBytes(claims.customerId).copy(payload, at);
  at += 16;
  payload.writeUInt32BE(dayNumber(claims.from), at);
  at += 4;
  payload.writeUInt32BE(dayNumber(claims.to), at);
  at += 4;
  payload.writeUInt32BE(Math.floor(claims.expiresAt.getTime() / 1000), at);
  at += 4;
  payload.writeUInt8(branches.length, at);
  at += 1;
  for (const id of branches) {
    uuidToBytes(id).copy(payload, at);
    at += 16;
  }

  return Buffer.concat([payload, sign(key, payload)]).toString("base64url");
}

/**
 * Signature first, expiry second: an expired link is only reported as such
 * once it is known to be one this system issued. Anything else — truncated,
 * tampered, another version — is the same "invalid", so the answer leaks
 * nothing about why.
 */
export function readStatementLinkToken(key: Buffer, token: string, now = new Date()): StatementLinkCheck {
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return { ok: false, reason: "invalid" };
  const raw = Buffer.from(token, "base64url");
  if (raw.length < FIXED_BYTES + SIGNATURE_BYTES) return { ok: false, reason: "invalid" };

  const payload = raw.subarray(0, raw.length - SIGNATURE_BYTES);
  const given = raw.subarray(raw.length - SIGNATURE_BYTES);
  if (!timingSafeEqual(given, sign(key, payload))) return { ok: false, reason: "invalid" };

  if (payload.readUInt8(0) !== VERSION) return { ok: false, reason: "invalid" };
  const branchCount = payload.readUInt8(FIXED_BYTES - 1);
  if (payload.length !== FIXED_BYTES + branchCount * 16) return { ok: false, reason: "invalid" };

  const expiresAt = new Date(payload.readUInt32BE(41) * 1000);
  if (expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };

  const branchIds: string[] = [];
  for (let i = 0; i < branchCount; i++) {
    const start = FIXED_BYTES + i * 16;
    branchIds.push(bytesToUuid(payload.subarray(start, start + 16)));
  }

  return {
    ok: true,
    claims: {
      tenantId: bytesToUuid(payload.subarray(1, 17)),
      customerId: bytesToUuid(payload.subarray(17, 33)),
      from: dayString(payload.readUInt32BE(33)),
      to: dayString(payload.readUInt32BE(37)),
      expiresAt,
      branchIds: branchCount > 0 ? branchIds : null,
    },
  };
}
