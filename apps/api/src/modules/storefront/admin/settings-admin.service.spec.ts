import { DEFAULT_STOREFRONT_SETTINGS, resolveStorefrontSettings, type StorefrontSettings } from "@devsfleet/shared-types";
import { describe, expect, it } from "vitest";
import { RequestContext } from "../../../common/context/request-context.js";
import type { TenantDatabase } from "../../../database/tenant-database.service.js";
import type { StorefrontResolver } from "../context/storefront-resolver.service.js";
import { regionPreset } from "../region.js";
import { SettingsAdminService } from "./settings-admin.service.js";
import type { UpdateSettingsDto } from "./dto.js";

const BRANCH = "0b1a2c3d-0000-4000-8000-000000000001";

/** The service over a fake transaction that records what was written to `storefronts.settings`. */
function setup(stored: Partial<StorefrontSettings> = {}, planId = "pro") {
  const writes: { settings: StorefrontSettings }[] = [];
  // A delivery line already exists, so update() never has to create one.
  let settings: unknown = { checkout: { ...DEFAULT_STOREFRONT_SETTINGS.checkout, deliveryVariantId: "variant-1" }, ...stored };
  const tx = {
    query: {
      storefronts: { findFirst: async () => ({ id: "sf-1", name: "Shop", isActive: true, settings }) },
      tenants: { findFirst: async () => ({ planId, name: "Tenant" }) },
      storefrontDomains: { findMany: async () => [] },
      storefrontPaymentAccounts: { findFirst: async () => undefined },
      branches: { findFirst: async () => ({ id: BRANCH }) },
    },
    update: () => ({
      set: (values: { settings: StorefrontSettings }) => ({
        where: async () => {
          writes.push(values);
          settings = values.settings;
        },
      }),
    }),
  };
  const db = { run: async (fn: (t: unknown) => unknown) => fn(tx) } as unknown as TenantDatabase;
  const resolver = { invalidateTenant: () => undefined } as unknown as StorefrontResolver;
  const config = { get: () => undefined } as never;
  const service = new SettingsAdminService(db, resolver, config);
  const update = (dto: UpdateSettingsDto) =>
    RequestContext.run({ requestId: "t", startedAt: 0, tenantId: "tenant-1" } as never, () => service.update(dto));
  return { update, writes, latest: () => writes.at(-1)!.settings };
}

const rate = (emirate: string) => ({ emirate, baseFee: "10", baseWeightKg: 5, perKgFee: "1", freeOver: null, maxWeightKg: 30, etaDays: 2, active: true });

describe("SettingsAdminService.update — appearance", () => {
  it("merges a partial theme over the stored one, one level per block", async () => {
    const { update, latest } = setup({ theme: { ...DEFAULT_STOREFRONT_SETTINGS.theme, font: "inter" } });
    await update({ theme: { colors: { accent: "#112233" }, layout: { header: "centered" } } });
    const theme = latest().theme;
    expect(theme.colors).toMatchObject({ accent: "#112233", ink: DEFAULT_STOREFRONT_SETTINGS.theme.colors.ink });
    expect(theme.layout).toMatchObject({ header: "centered", footer: DEFAULT_STOREFRONT_SETTINGS.theme.layout.footer });
    expect(theme.font).toBe("inter");
  });

  it("replaces social links wholesale, so a network can be removed", async () => {
    const { update, latest } = setup({ theme: { ...DEFAULT_STOREFRONT_SETTINGS.theme, social: { instagram: "https://i.com/a", x: "https://x.com/a" } } });
    await update({ theme: { social: { x: "https://x.com/a" } } });
    expect(latest().theme.social).toEqual({ x: "https://x.com/a" });
  });

  it("replaces home sections and navigation lists wholesale", async () => {
    const { update, latest } = setup();
    await update({ homeSections: [{ id: "b", type: "brands", enabled: true, settings: {} }], navigation: { header: [{ label: "Blog", href: "/blog" }] } });
    expect(latest().homeSections.map((s) => s.id)).toEqual(["b"]);
    expect(latest().navigation.header).toEqual([{ label: "Blog", href: "/blog" }]);
    expect(latest().navigation.footerNote).toBe("");
  });

  it("leaves everything else alone on an unrelated save", async () => {
    const { update, latest } = setup({ tagline: "Hello", region: regionPreset("SA"), shipping: { rates: [rate("STALE_ZONE")] } });
    await update({ theme: { font: "poppins" } });
    expect(latest().tagline).toBe("Hello");
    expect(latest().shipping.rates[0]?.emirate).toBe("STALE_ZONE");
  });
});

describe("SettingsAdminService.update — region", () => {
  it("accepts a new region together with rates and branches inside it", async () => {
    const { update, latest } = setup();
    const sa = regionPreset("SA");
    await update({ region: sa, shipping: { rates: [rate("RIYADH")] }, branches: [{ branchId: BRANCH, emirate: "MAKKAH", lat: null, lng: null, openingHours: null, pickupEnabled: true }] });
    expect(latest().region.country).toBe("SA");
  });

  it("refuses to swap the zones while rates still name the old ones", async () => {
    const { update, writes } = setup({ shipping: { rates: [rate("DUBAI")] } });
    await expect(update({ region: { zones: [{ code: "RIYADH", name: "Riyadh" }] } })).rejects.toThrow(/"DUBAI"/);
    expect(writes).toHaveLength(0);
  });

  it("refuses a delivery rate or branch in a zone the region lacks", async () => {
    const { update } = setup();
    await expect(update({ shipping: { rates: [rate("RIYADH")] } })).rejects.toThrow(/"RIYADH"/);
    await expect(
      update({ branches: [{ branchId: BRANCH, emirate: "RIYADH", lat: null, lng: null, openingHours: null, pickupEnabled: true }] }),
    ).rejects.toThrow(/branch.*"RIYADH"/);
  });

  it("falls back to the UAE zones for a store saved before regions existed", () => {
    expect(resolveStorefrontSettings({}).region.zones.map((z) => z.code)).toContain("DUBAI");
  });
});

describe("SettingsAdminService.update — headless", () => {
  it("needs a plan with API access to switch it on", async () => {
    const trial = setup({}, "trial");
    await expect(trial.update({ headless: { enabled: true, allowedOrigins: ["https://app.example.com"] } })).rejects.toThrow(/API access/);

    const pro = setup({}, "pro");
    await pro.update({ headless: { enabled: true, allowedOrigins: ["https://app.example.com"] } });
    expect(pro.latest().headless).toEqual({ enabled: true, allowedOrigins: ["https://app.example.com"] });
  });

  it("lets a lapsed plan switch it OFF and edit the list", async () => {
    const { update, latest } = setup({ headless: { enabled: true, allowedOrigins: ["https://a.com"] } }, "trial");
    await update({ headless: { enabled: false } });
    expect(latest().headless).toEqual({ enabled: false, allowedOrigins: ["https://a.com"] });
  });
});
