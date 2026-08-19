import type Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { getDatabase } from "./sqlite.js";

/**
 * PIN verification with no network at all.
 *
 * Mirrors `resolvePinHolder` in the API's `auth.service.ts` as closely as this
 * terminal can: same candidate set (branch-scoped staff plus tenant-wide
 * ones), same ambiguous-PIN refusal. It has to agree with the server's
 * answer, or a cashier who works fine online behaves differently offline,
 * which is a debugging nightmare disguised as a hardware fault.
 *
 * What it cannot mirror is a per-ACCOUNT lockout — a wrong PIN identifies
 * nobody, so there is no account to blame it on, which is why the server's
 * own `pinLogin` does not track one either (contrast the password path, which
 * resolves the account from the email first). What guards a PIN online is the
 * route's rate limit, shared by everyone; `pin_throttle` is that idea moved to
 * the till, one counter for the whole terminal.
 */

interface StaffRow {
  id: string;
  branch_id: string | null;
  name: string;
  role_name: string;
  permissions: string;
  pin_hash: string | null;
  max_discount_percent: string;
}

export interface LocalCashier {
  id: string;
  name: string;
  roleName: string;
  permissions: string[];
  branchId: string | null;
  maxDiscountPercent: string;
}

/**
 * Ten wrong guesses inside five minutes locks local verification for fifteen.
 *
 * Sized to protect the hash from an unattended script, not to punish a
 * cashier who fat-fingers a PIN twice — a real person trying their own PIN
 * gets it right long before this trips.
 */
const MAX_FAILED_ATTEMPTS = 10;
const WINDOW_MS = 5 * 60_000;
const LOCKOUT_MS = 15 * 60_000;

interface ThrottleRow {
  failed_count: number;
  window_started_at: string | null;
  locked_until: string | null;
}

function readThrottle(db: Database.Database): ThrottleRow {
  const row = db
    .prepare(`SELECT failed_count, window_started_at, locked_until FROM pin_throttle WHERE id = 1`)
    .get() as ThrottleRow | undefined;
  return row ?? { failed_count: 0, window_started_at: null, locked_until: null };
}

function writeThrottle(db: Database.Database, next: ThrottleRow): void {
  db.prepare(
    `INSERT INTO pin_throttle (id, failed_count, window_started_at, locked_until)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       failed_count = excluded.failed_count,
       window_started_at = excluded.window_started_at,
       locked_until = excluded.locked_until`,
  ).run(next.failed_count, next.window_started_at, next.locked_until);
}

function throttleRemaining(db: Database.Database): string | null {
  const { locked_until } = readThrottle(db);
  if (!locked_until) return null;
  const ms = new Date(locked_until).getTime() - Date.now();
  if (ms <= 0) return null;
  const minutes = Math.ceil(ms / 60_000);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

function recordWrongAttempt(db: Database.Database): void {
  const now = Date.now();
  const throttle = readThrottle(db);
  const windowStart = throttle.window_started_at ? new Date(throttle.window_started_at).getTime() : null;
  const withinWindow = windowStart !== null && now - windowStart < WINDOW_MS;

  const failedCount = (withinWindow ? throttle.failed_count : 0) + 1;
  const lock = failedCount >= MAX_FAILED_ATTEMPTS;

  writeThrottle(db, {
    failed_count: lock ? 0 : failedCount,
    window_started_at: lock ? null : new Date(withinWindow ? windowStart! : now).toISOString(),
    locked_until: lock ? new Date(now + LOCKOUT_MS).toISOString() : throttle.locked_until,
  });
}

function clearThrottle(db: Database.Database): void {
  writeThrottle(db, { failed_count: 0, window_started_at: null, locked_until: null });
}

/**
 * Throws on a locked-out terminal, a wrong PIN, or an ambiguous one. Returns
 * the cashier on success, in the same shape the online path returns.
 *
 * `database` defaults to the real terminal database and exists as a parameter
 * only so a test can hand it an isolated one instead of the live singleton.
 */
export function verifyPinLocally(
  pin: string,
  branchId: string,
  database?: Database.Database,
): LocalCashier {
  const db = database ?? getDatabase();
  const locked = throttleRemaining(db);
  if (locked) {
    throw new Error(`Too many attempts on this terminal. Try again in ${locked}.`);
  }

  // One branch's staff plus tenant-wide users (owners, area managers) — the
  // same set an online PIN login would consider at this branch. A handful of
  // rows pulled down at sync time, not a scan.
  const candidates = db
    .prepare(
      `SELECT * FROM staff WHERE pin_hash IS NOT NULL AND (branch_id IS NULL OR branch_id = ?)`,
    )
    .all(branchId) as StaffRow[];

  const matches: StaffRow[] = [];
  for (const candidate of candidates) {
    if (!bcrypt.compareSync(pin, candidate.pin_hash!)) continue;
    matches.push(candidate);
  }

  if (matches.length > 1) {
    // Not counted against the throttle: this is a data problem (two staff
    // sharing a PIN), not a guessing attempt.
    throw new Error(
      "More than one person at this branch uses that PIN. Ask a manager to change it.",
    );
  }

  const [match] = matches;
  if (!match) {
    recordWrongAttempt(db);
    throw new Error("Incorrect PIN");
  }

  clearThrottle(db);
  return {
    id: match.id,
    name: match.name,
    roleName: match.role_name,
    permissions: JSON.parse(match.permissions) as string[],
    // The TERMINAL's branch, not the matched user's own `branch_id` column —
    // that column is null for a tenant-wide user (an owner, an area manager),
    // and the online path returns `dto.branchId` for exactly this reason: a
    // session is always pinned to the till it was opened at, whatever the
    // signed-in user's own default scope otherwise is.
    branchId,
    maxDiscountPercent: match.max_discount_percent,
  };
}
