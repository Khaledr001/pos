import { DEFAULT_TENANT_SETTINGS } from "@devsfleet/shared-types";
import { AppError } from "@devsfleet/shared-utils";
import { describe, expect, it } from "vitest";
import { RequestContext } from "../../common/context/request-context.js";
import type { TenantDatabase } from "../../database/tenant-database.service.js";
import { UpdateTenantSettingsSchema } from "./dto.js";
import { TenantsService } from "./tenants.service.js";

function setup(stored: unknown) {
  const sets: unknown[] = [];
  const tx = {
    query: { tenants: { findFirst: async () => ({ id: "t1", settings: stored }) } },
    update: () => ({
      set: (values: unknown) => {
        sets.push(values);
        return { where: async () => undefined };
      },
    }),
  };
  const db = { run: async (fn: (t: unknown) => unknown) => fn(tx) } as unknown as TenantDatabase;
  const service = new TenantsService(db);
  const patch = (input: Record<string, unknown>) =>
    RequestContext.run({ requestId: "t", tenantId: "t1", startedAt: 0 }, () => service.updateSettings(UpdateTenantSettingsSchema.parse(input)));
  return { sets, patch };
}

describe("TenantsService.updateSettings", () => {
  it("validates and normalises a new TRN", async () => {
    const { patch } = setup({});
    expect((await patch({ trn: "100 2345 6780 0003" })).trn).toBe("100234567800003");
    await expect(patch({ trn: "12345" })).rejects.toBeInstanceOf(AppError);
  });

  it("a blank TRN clears it", async () => {
    const { patch } = setup({ trn: "100234567800003" });
    expect((await patch({ trn: "" })).trn).toBe("");
  });

  it("stores a validated legal address, the emirate as its code", async () => {
    const { patch } = setup({});
    const saved = await patch({ legalAddress: { line1: "Shop 4", city: "Dubai", subdivision: "Dubai", countryCode: "ae" } });
    expect(saved.legalAddress).toEqual({ line1: "Shop 4", city: "Dubai", subdivision: "DXB", countryCode: "AE" });
    await expect(patch({ legalAddress: { line1: "x", city: "y", subdivision: "Nowhere", countryCode: "AE" } })).rejects.toBeInstanceOf(AppError);
  });

  it("writes only the keys the request changed, as a jsonb merge — never the whole object", async () => {
    const { sets, patch } = setup({ einvoice: { ...DEFAULT_TENANT_SETTINGS.einvoice, enabled: true } });
    await patch({ phone: "+971501234567" });
    expect(sets).toHaveLength(1);
    // A drizzle sql`` merge expression, not a plain settings object: the
    // bound parameter is just the keys this request changed.
    const written = (sets[0] as { settings: { queryChunks: unknown[] } }).settings;
    const param = written.queryChunks.find((c): c is string => typeof c === "string");
    expect(JSON.parse(param!)).toEqual({ phone: "+971501234567" });
  });

  it("cannot be used to write the e-invoicing block: the schema drops it", () => {
    const parsed = UpdateTenantSettingsSchema.parse({ phone: "1", einvoice: { enabled: true, mode: "live" } });
    expect(parsed).toEqual({ phone: "1" });
  });

  it("writes nothing when nothing changed", async () => {
    const { sets, patch } = setup({});
    await patch({});
    expect(sets).toEqual([]);
  });

  it("merges a section one level, so a tax patch keeps the other tax settings", async () => {
    const { patch } = setup({ tax: { ...DEFAULT_TENANT_SETTINGS.tax, label: "VAT", defaultRate: 5 } });
    const saved = await patch({ tax: { defaultRate: 6 } });
    expect(saved.tax).toMatchObject({ label: "VAT", defaultRate: 6, mode: "exclusive" });
  });
});
