import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../db/sqlite.js";

/**
 * `printer:probe` is what the sale screen asks before auto-printing the bill.
 *
 * It has to answer for a till with no printer wired — the common case on a
 * terminal being set up, and on every developer machine — because the
 * alternative is a red print failure on every completed sale. Same
 * singleton-mocking approach as the db tests.
 */
let db: Database.Database;

vi.mock("../../db/sqlite.js", async () => {
  const actual = await vi.importActual<typeof import("../../db/sqlite.js")>("../../db/sqlite.js");
  return { ...actual, getDatabase: () => db };
});

const { registerHardwareHandlers } = await import("../index.js");
const { setState } = await import("../../db/repositories.js");

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function handlers(): Map<string, Handler> {
  const registered = new Map<string, Handler>();
  registerHardwareHandlers({
    handle: (channel: string, handler: Handler) => registered.set(channel, handler),
  } as never);
  return registered;
}

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

describe("printer:probe", () => {
  it("reports the terminal's configured format and device", async () => {
    setState("printer_format", "thermal_58");
    setState("printer_device_path", "/dev/usb/lp3");

    const probe = (await handlers().get("printer:probe")!({})) as {
      format: string;
      devicePath: string;
      reachable: boolean;
    };

    expect(probe.format).toBe("thermal_58");
    expect(probe.devicePath).toBe("/dev/usb/lp3");
  });

  it("defaults to 80mm when nothing has been configured yet", async () => {
    const probe = (await handlers().get("printer:probe")!({})) as { format: string };
    expect(probe.format).toBe("thermal_80");
  });

  /**
   * The whole point of the channel: a device path that does not exist reports
   * unreachable rather than throwing, so the till can offer the A4 copy —
   * which needs no hardware — instead of failing the print.
   */
  it("reports unreachable for a device path that is not there", async () => {
    setState("printer_device_path", "/dev/definitely-not-a-printer");
    const probe = (await handlers().get("printer:probe")!({})) as { reachable: boolean };
    expect(probe.reachable).toBe(false);
  });

  /** A4 renders a PDF and opens it — there is no device to be unreachable. */
  it("reports A4 as always reachable", async () => {
    setState("printer_format", "a4");
    setState("printer_device_path", "/dev/definitely-not-a-printer");
    const probe = (await handlers().get("printer:probe")!({})) as { reachable: boolean };
    expect(probe.reachable).toBe(true);
  });
});
