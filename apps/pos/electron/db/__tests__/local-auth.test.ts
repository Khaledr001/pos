import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../sqlite.js";
import { verifyPinLocally } from "../local-auth.js";

/**
 * Runs under Electron's Node — see migrations.test.ts for why.
 *
 * Every case here has a server-side twin in auth.service.spec-shaped
 * behaviour (this repo has no unit test file for auth.service.ts itself, but
 * the logic mirrored is `resolvePinHolder`): this module exists to AGREE with
 * that function, not to define its own rules.
 */

const SHARJAH = "branch-shj";
const DUBAI = "branch-dxb";

function seedDatabase(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function seedStaff(
  db: Database.Database,
  rows: Array<{
    id: string;
    branchId: string | null;
    name: string;
    roleName: string;
    permissions: string[];
    pin: string | null;
    maxDiscountPercent?: string;
  }>,
): void {
  const insert = db.prepare(
    `INSERT INTO staff (id, branch_id, name, role_name, permissions, pin_hash, max_discount_percent, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  );
  for (const row of rows) {
    insert.run(
      row.id,
      row.branchId,
      row.name,
      row.roleName,
      JSON.stringify(row.permissions),
      row.pin ? bcrypt.hashSync(row.pin, 4) : null,
      row.maxDiscountPercent ?? "0",
    );
  }
}

describe("verifyPinLocally", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = seedDatabase();
  });

  it("signs in a unique match at their own branch", () => {
    seedStaff(db, [
      { id: "u1", branchId: SHARJAH, name: "Cashier One", roleName: "cashier", permissions: ["sale:create"], pin: "1111" },
    ]);

    const cashier = verifyPinLocally("1111", SHARJAH, db);
    expect(cashier).toMatchObject({ id: "u1", name: "Cashier One", roleName: "cashier" });
    expect(cashier.permissions).toEqual(["sale:create"]);
  });

  it("matches a tenant-wide user (branch_id null) at any branch", () => {
    seedStaff(db, [
      { id: "owner", branchId: null, name: "Owner", roleName: "admin", permissions: ["*"], pin: "9999" },
    ]);

    expect(verifyPinLocally("9999", SHARJAH, db).id).toBe("owner");
    expect(verifyPinLocally("9999", DUBAI, db).id).toBe("owner");
  });

  it("pins the session to the TERMINAL's branch, not the owner's own (null) one", () => {
    seedStaff(db, [
      { id: "owner", branchId: null, name: "Owner", roleName: "admin", permissions: ["*"], pin: "9999" },
    ]);

    // Matches the online path: pinLogin always returns dto.branchId, never
    // the matched user's own branchId column.
    expect(verifyPinLocally("9999", SHARJAH, db).branchId).toBe(SHARJAH);
    expect(verifyPinLocally("9999", DUBAI, db).branchId).toBe(DUBAI);
  });

  it("refuses a PIN from another branch's staff", () => {
    seedStaff(db, [
      { id: "u1", branchId: DUBAI, name: "Dubai Cashier", roleName: "cashier", permissions: [], pin: "1111" },
    ]);

    expect(() => verifyPinLocally("1111", SHARJAH, db)).toThrow("Incorrect PIN");
  });

  it("refuses an ambiguous PIN rather than guessing", () => {
    seedStaff(db, [
      { id: "u1", branchId: SHARJAH, name: "Cashier One", roleName: "cashier", permissions: [], pin: "1234" },
      { id: "u2", branchId: SHARJAH, name: "Cashier Two", roleName: "cashier", permissions: [], pin: "1234" },
    ]);

    expect(() => verifyPinLocally("1234", SHARJAH, db)).toThrow(/more than one person/i);
  });

  it("ignores staff with no PIN set", () => {
    seedStaff(db, [{ id: "u1", branchId: SHARJAH, name: "No PIN", roleName: "cashier", permissions: [], pin: null }]);
    expect(() => verifyPinLocally("0000", SHARJAH, db)).toThrow("Incorrect PIN");
  });

  it("locks the TERMINAL, not the account, after repeated wrong guesses", () => {
    seedStaff(db, [
      { id: "u1", branchId: SHARJAH, name: "Cashier One", roleName: "cashier", permissions: [], pin: "1111" },
    ]);

    // All ten count as ordinary wrong guesses to the CALLER — same as the
    // server's own password lockout, the request that trips the threshold
    // still reports what actually happened to it. Only the NEXT one sees the
    // lock, which is what actually matters: this is the one that must not be
    // let through.
    for (let i = 0; i < 10; i++) {
      expect(() => verifyPinLocally("0000", SHARJAH, db)).toThrow("Incorrect PIN");
    }

    // The lock blocks even the RIGHT pin now — it protects the terminal, not
    // whichever account almost got guessed.
    expect(() => verifyPinLocally("1111", SHARJAH, db)).toThrow(/too many attempts/i);
  });

  it("a correct sign-in clears the throttle", () => {
    seedStaff(db, [
      { id: "u1", branchId: SHARJAH, name: "Cashier One", roleName: "cashier", permissions: [], pin: "1111" },
    ]);

    for (let i = 0; i < 5; i++) {
      expect(() => verifyPinLocally("0000", SHARJAH, db)).toThrow("Incorrect PIN");
    }
    verifyPinLocally("1111", SHARJAH, db);

    // Back to a clean slate: nine more wrong guesses still do not lock it,
    // because the successful sign-in above reset the counter.
    for (let i = 0; i < 9; i++) {
      expect(() => verifyPinLocally("0000", SHARJAH, db)).toThrow("Incorrect PIN");
    }
    expect(() => verifyPinLocally("1111", SHARJAH, db)).not.toThrow();
  });

  it("carries the discount ceiling through", () => {
    seedStaff(db, [
      {
        id: "u1",
        branchId: SHARJAH,
        name: "Cashier One",
        roleName: "cashier",
        permissions: ["sale:discount"],
        pin: "1111",
        maxDiscountPercent: "12.50",
      },
    ]);

    expect(verifyPinLocally("1111", SHARJAH, db).maxDiscountPercent).toBe("12.50");
  });
});
