import { DEFAULT_TENANT_SETTINGS } from "@devsfleet/shared-types";
import { AppError } from "@devsfleet/shared-utils";
import { describe, expect, it, vi } from "vitest";
import { RequestContext } from "../../common/context/request-context.js";
import type { TenantDatabase } from "../../database/tenant-database.service.js";
import { CreateCustomerSchema, UpdateCustomerSchema } from "./dto.js";
import { CustomersService } from "./customers.service.js";

/** A thenable that is also chainable, standing in for a Drizzle query builder. */
function chain(result: unknown, sink?: (call: string, args: unknown[]) => void): any {
  const target: any = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve(result);
      return (...args: unknown[]) => {
        sink?.(String(prop), args);
        return target;
      };
    },
  });
  return target;
}

function setup(opts: { settings?: unknown; existing?: Record<string, unknown> | undefined } = {}) {
  const written: { kind: string; values: Record<string, unknown> }[] = [];
  const existingReads = vi.fn();
  const tx = {
    query: {
      tenants: { findFirst: async () => ({ settings: opts.settings ?? DEFAULT_TENANT_SETTINGS }) },
      customers: {
        findFirst: async () => {
          existingReads();
          return opts.existing;
        },
      },
    },
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        written.push({ kind: "insert", values });
        return { returning: async () => [{ id: "c1", ...values }] };
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        written.push({ kind: "update", values });
        return chain([{ id: "c1", ...values }]);
      },
    }),
  };
  const db = { run: async (fn: (t: unknown) => unknown) => fn(tx) } as unknown as TenantDatabase;
  const service = new CustomersService(db);
  const inContext = <T>(fn: () => T): T =>
    RequestContext.run({ requestId: "t", tenantId: "00000000-0000-4000-8000-000000000001", startedAt: 0 }, fn);
  return { service, written, existingReads, inContext };
}

const create = (input: Record<string, unknown>) => CreateCustomerSchema.parse({ name: "Al Manar LLC", ...input });
const update = (input: Record<string, unknown>) => UpdateCustomerSchema.parse(input);

describe("CustomersService — party validation", () => {
  it("normalises a TRN and stores it without spaces", async () => {
    const { service, written, inContext } = setup();
    await inContext(() => service.create(create({ trn: "100 2345 6780 0003" })));
    expect(written[0]!.values.trn).toBe("100234567800003");
  });

  it("refuses an invalid UAE TRN on create, naming the field", async () => {
    const { service, inContext } = setup();
    await expect(inContext(() => service.create(create({ trn: "12345" })))).rejects.toMatchObject({
      details: { fields: { trn: [expect.stringContaining("15 digits")] } },
    });
  });

  it("a blank TRN is no TRN and is not an error", async () => {
    const { service, written, inContext } = setup();
    await inContext(() => service.create(create({ trn: "  " })));
    expect(written[0]!.values.trn).toBeNull();
  });

  it("stores the structured address with the emirate as its code", async () => {
    const { service, written, inContext } = setup();
    await inContext(() =>
      service.create(create({ addressLine1: "Warehouse 4", addressCity: "Sharjah", addressSubdivision: "sharjah", addressCountry: "ae" })),
    );
    expect(written[0]!.values).toMatchObject({
      addressLine1: "Warehouse 4",
      addressCity: "Sharjah",
      addressSubdivision: "SHJ",
      addressCountry: "AE",
    });
  });

  it("refuses a UAE address whose emirate is not one", async () => {
    const { service, inContext } = setup();
    await expect(inContext(() => service.create(create({ addressSubdivision: "Riyadh" })))).rejects.toBeInstanceOf(AppError);
  });

  it("a Peppol scheme without an address (or the reverse) is refused", async () => {
    const { service, inContext } = setup();
    await expect(inContext(() => service.create(create({ einvoiceScheme: "0235" })))).rejects.toMatchObject({
      details: { fields: { einvoiceEndpoint: [expect.any(String)] } },
    });
    await expect(inContext(() => service.create(create({ einvoiceEndpoint: "1002345678" })))).rejects.toMatchObject({
      details: { fields: { einvoiceScheme: [expect.any(String)] } },
    });
    const ok = setup();
    await ok.inContext(() => ok.service.create(create({ einvoiceScheme: "0235", einvoiceEndpoint: "1002345678" })));
    expect(ok.written[0]!.values).toMatchObject({ einvoiceScheme: "0235", einvoiceEndpoint: "1002345678" });
  });

  it("an update that names no tax-identity field never reads or validates the stored ones", async () => {
    const { service, written, existingReads, inContext } = setup({ existing: { trn: "bad-old-value" } });
    await inContext(() => service.update("c1", update({ phone: "0501234567" })));
    expect(existingReads).not.toHaveBeenCalled();
    expect(written[0]!.values).not.toHaveProperty("trn");
  });

  it("an update never resets what it did not name (type, language, payment terms)", async () => {
    const { service, written, inContext } = setup();
    await inContext(() => service.update("c1", update({ notes: "Pays on the 5th" })));
    expect(written[0]!.values).toEqual({ notes: "Pays on the 5th" });
  });

  it("an update validates a TRN it does name", async () => {
    const { service, inContext } = setup({ existing: { id: "c1" } });
    await expect(inContext(() => service.update("c1", update({ trn: "nope" })))).rejects.toBeInstanceOf(AppError);
  });

  it("the Peppol pair is judged against what is stored when only one half is sent", async () => {
    const stored = { id: "c1", einvoiceScheme: "0235", einvoiceEndpoint: "1002345678" };
    const keep = setup({ existing: stored });
    await keep.inContext(() => keep.service.update("c1", update({ einvoiceEndpoint: "1009999999" })));
    expect(keep.written[0]!.values.einvoiceEndpoint).toBe("1009999999");

    const clearHalf = setup({ existing: stored });
    await expect(clearHalf.inContext(() => clearHalf.service.update("c1", update({ einvoiceEndpoint: null })))).rejects.toBeInstanceOf(AppError);
    const clearBoth = setup({ existing: stored });
    await clearBoth.inContext(() => clearBoth.service.update("c1", update({ einvoiceScheme: null, einvoiceEndpoint: null })));
    expect(clearBoth.written[0]!.values).toMatchObject({ einvoiceScheme: null, einvoiceEndpoint: null });
  });

  it("a non-UAE business is held only to a lenient tax-id shape", async () => {
    const saudi = {
      ...DEFAULT_TENANT_SETTINGS,
      currency: { ...DEFAULT_TENANT_SETTINGS.currency, base: "SAR" },
      locale: { ...DEFAULT_TENANT_SETTINGS.locale, timezone: "Asia/Riyadh" },
    };
    const { service, written, inContext } = setup({ settings: saudi });
    await inContext(() => service.create(create({ trn: "3101234567" })));
    expect(written[0]!.values.trn).toBe("3101234567");
  });
});

describe("customer DTOs", () => {
  it("create keeps the defaults a new customer starts from", () => {
    expect(create({})).toMatchObject({ type: "retail", locale: "en", paymentTermDays: 0, creditLimit: "0.0000" });
  });

  it("update carries no defaults: only what was sent", () => {
    expect(update({})).toEqual({});
    expect(update({ type: "wholesale" })).toEqual({ type: "wholesale" });
  });

  it("clears an address field with a blank, upper-cases the emirate, and checks the country shape", () => {
    expect(update({ addressLine2: "  " }).addressLine2).toBeNull();
    expect(update({ addressSubdivision: "dxb" }).addressSubdivision).toBe("DXB");
    expect(UpdateCustomerSchema.safeParse({ addressCountry: "UAE" }).success).toBe(false);
    expect(UpdateCustomerSchema.safeParse({ einvoiceScheme: "02" }).success).toBe(false);
  });
});
