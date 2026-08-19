import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../sqlite.js";

/**
 * Runs under Electron's Node, not plain Node.
 *
 * `better-sqlite3` is a native binding compiled against whichever ABI ran the
 * last `pnpm install` — this repo's `postinstall` rebuilds it for Electron, so
 * a plain `vitest run` cannot load it (`NODE_MODULE_VERSION` mismatch). See
 * `pnpm test:electron` in package.json, which runs this file through the
 * Electron binary via `ELECTRON_RUN_AS_NODE=1`.
 *
 * This is the test blocker **B1** asked for: replay every migration against an
 * empty database. A fresh terminal crashed before its window ever opened
 * because migration v4 assumed a column that migration v3 had already been
 * edited to create — invisible to every other check in the repo, because
 * every machine that had already run the app was unaffected.
 */
function freshDatabase(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  return db;
}

describe("SQLite migrations", () => {
  it("replay cleanly against an empty database", () => {
    const db = freshDatabase();
    expect(() => migrate(db)).not.toThrow();
    db.close();
  });

  it("leave the schema a fresh terminal actually needs", () => {
    const db = freshDatabase();
    migrate(db);

    const columns = (table: string) =>
      new Set((db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name));

    // The exact three changes migration v4 is responsible for, however the
    // database arrived — whether v3 created `is_default` itself or not.
    expect(columns("variant_prices")).toContain("is_default");
    expect(columns("local_sale_items")).toContain("variant_id");
    expect(columns("local_sale_items")).not.toContain("product_id");
    expect(columns("local_sale_items")).toContain("unit_abbr");

    db.close();
  });

  it("re-run safely on a database that already migrated", () => {
    // Every app boot calls `migrate()` again, unconditionally. If replaying
    // it against an up-to-date database were unsafe, every SECOND launch of
    // a working terminal would be the crash, not just the first one on a new
    // machine — which is exactly the class of bug this file exists to catch.
    const db = freshDatabase();
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
    db.close();
  });

  it("refuses to run against a NEWER database than this build understands", () => {
    // A downgrade. The outbox may hold unsynced sales in a shape this build
    // does not recognise — refusing is the safe failure, guessing is not.
    const db = freshDatabase();
    migrate(db);
    const future = (db.pragma("user_version", { simple: true }) as number) + 1;
    db.pragma(`user_version = ${future}`);

    expect(() => migrate(db)).toThrow(/newer/i);
    db.close();
  });
});
