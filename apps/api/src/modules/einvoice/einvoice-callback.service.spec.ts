import { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import { SecretBoxService } from "../../common/crypto/secret-box.service.js";
import { EinvoiceCallbackService } from "./einvoice-callback.service.js";
import { sign } from "./providers/signature.js";

const secrets = new SecretBoxService({ get: (k: string) => (k === "NODE_ENV" ? "test" : undefined) } as unknown as ConfigService<never, true>);
const CREDENTIAL = "provider-credential-123";
const TOKEN = "6f1f0a3e-5b1a-4c6e-9d2e-3a8f0c1b2d4e";

function service(account: Record<string, unknown> | null, doc: Record<string, unknown> | null = null) {
  const updates: unknown[] = [];
  const tx = {
    query: {
      einvoiceAccounts: { findFirst: async () => account },
      einvoiceDocuments: { findFirst: async () => doc },
    },
    update: () => ({ set: (v: unknown) => ({ where: () => ({ returning: async () => (updates.push(v), [{ id: "d1" }]) }) }) }),
    insert: () => ({ values: async () => undefined }),
  };
  const db = { runAsPlatformAdmin: async (fn: (t: typeof tx) => unknown) => fn(tx), runAs: async (_t: string, fn: (t: typeof tx) => unknown) => fn(tx) };
  return { svc: new EinvoiceCallbackService(db as never, secrets), updates };
}

const account = () => ({ tenantId: "t1", credentialsEnc: secrets.encrypt(CREDENTIAL) });
const body = (o: object) => Buffer.from(JSON.stringify(o));

describe("callback authentication", () => {
  it("refuses an unknown token and a bad signature with the same answer", async () => {
    const good = body({ id: "x", status: "delivered" });
    const unknown = await service(null).svc.handle(TOKEN, good, sign(good, CREDENTIAL)).catch((e) => e);
    const badSig = await service(account()).svc.handle(TOKEN, good, sign(good, "wrong")).catch((e) => e);
    const noSig = await service(account()).svc.handle(TOKEN, good, undefined).catch((e) => e);
    for (const e of [unknown, badSig, noSig]) {
      expect(e.code).toBe("INVALID_CREDENTIALS");
      expect(e.message).toBe("The callback could not be verified.");
    }
  });

  it("refuses an empty or oversized body, and a signature over a different body", async () => {
    expect((await service(account()).svc.handle(TOKEN, undefined, "x").catch((e) => e)).code).toBe("INVALID_CREDENTIALS");
    expect((await service(account()).svc.handle(TOKEN, Buffer.alloc(300_000, 1), "x").catch((e) => e)).code).toBe("INVALID_CREDENTIALS");
    const real = body({ id: "x", status: "delivered" });
    const forged = body({ id: "x", status: "rejected" });
    expect((await service(account()).svc.handle(TOKEN, forged, sign(real, CREDENTIAL)).catch((e) => e)).code).toBe("INVALID_CREDENTIALS");
  });
});

describe("callback application", () => {
  const doc = (status: string) => ({ id: "d1", tenantId: "t1", status, submittedAt: null });
  const call = (status: string, reported: string, extra: object = {}) => {
    const b = body({ id: "asp-1", status: reported, ...extra });
    const s = service(account(), doc(status));
    return { s, run: () => s.svc.handle(TOKEN, b, sign(b, CREDENTIAL)) };
  };

  it("marks a submitted document delivered", async () => {
    const { s, run } = call("submitted", "delivered");
    expect(await run()).toEqual({ ok: true, applied: true });
    expect(s.updates[0]).toMatchObject({ status: "delivered" });
  });

  it("ignores a repeat and a report that would move a document backwards", async () => {
    expect(await call("delivered", "delivered").run()).toEqual({ ok: true, applied: false });
    expect(await call("delivered", "accepted").run()).toEqual({ ok: true, applied: false });
    expect(await call("delivered", "rejected").run()).toEqual({ ok: true, applied: false });
  });

  it("records the network's reasons on a late rejection", async () => {
    const { s, run } = call("submitted", "rejected", { errors: [{ code: "IBR-010", message: "Bad buyer" }] });
    await run();
    expect(s.updates[0]).toMatchObject({ status: "rejected", issues: [{ code: "IBR-010", message: "Bad buyer", severity: "error" }] });
  });

  it("reports an unknown reference as not found", async () => {
    const b = body({ id: "nope", status: "delivered" });
    const err = await service(account(), null).svc.handle(TOKEN, b, sign(b, CREDENTIAL)).catch((e) => e);
    expect(err.code).toBe("NOT_FOUND");
  });
});

void vi;
