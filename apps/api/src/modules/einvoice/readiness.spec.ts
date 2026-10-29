import { DEFAULT_TENANT_SETTINGS } from "@devsfleet/shared-types";
import { describe, expect, it } from "vitest";
import { UpdateEinvoiceSettingsSchema, UpdateProviderSchema, ListDocumentsSchema, CallbackBodySchema } from "./dto.js";
import { assessReadiness, customerProblems, type ReadinessCustomer } from "./readiness.js";
import { tenantSettings } from "./pint-ae/test-fixtures.js";

const customer = (over: Partial<ReadinessCustomer> = {}): ReadinessCustomer => ({
  id: "c1",
  name: "Khaled",
  company: "Noor FZE",
  trn: "100987654300003",
  addressLine1: "Warehouse 12",
  addressCity: "Sharjah",
  addressSubdivision: "SHJ",
  addressCountry: "AE",
  ...over,
});

describe("customer readiness", () => {
  it("passes a complete record", () => expect(customerProblems(customer())).toEqual([]));

  it("names each problem", () => {
    expect(customerProblems(customer({ trn: null }))).toEqual(["No TRN"]);
    expect(customerProblems(customer({ trn: "100987654300004" }))[0]).toMatch(/ending 03/);
    expect(customerProblems(customer({ addressLine1: null, addressCity: "" }))[0]).toBe("Address is missing: street, city");
    expect(customerProblems(customer({ addressSubdivision: "Dubai" }))[0]).toMatch(/must be one of AUH, DXB/);
    expect(customerProblems(customer({ addressSubdivision: "Whatever", addressCountry: "SA" }))).toEqual([]);
  });
});

describe("readiness report", () => {
  const sandbox = { kind: "sandbox" as const, hasCredentials: false, hasEndpoint: false };

  it("is ready for a sandbox rehearsal once identity and a customer are in place", () => {
    const report = assessReadiness({ settings: tenantSettings(), provider: sandbox, encryptionAvailable: true, customers: [customer()] });
    expect(report.checks.find((c) => c.key === "provider")?.ok).toBe(true);
    expect(report.ready).toBe(true);
    expect(report.customerIssueTotal).toBe(0);
  });

  it("lists exactly what is missing for a bare business", () => {
    const report = assessReadiness({ settings: { ...DEFAULT_TENANT_SETTINGS }, provider: null, encryptionAvailable: true, customers: [] });
    const failed = report.checks.filter((c) => !c.ok).map((c) => c.key);
    expect(failed).toEqual(expect.arrayContaining(["seller_trn", "legal_address", "endpoint", "legal_registration", "b2b_customer"]));
    expect(report.ready).toBe(false);
  });

  it("needs a connected provider to go live, and says why when the server cannot hold credentials", () => {
    const live = tenantSettings({ einvoice: { ...tenantSettings().einvoice, mode: "live" } });
    expect(assessReadiness({ settings: live, provider: sandbox, encryptionAvailable: true, customers: [customer()] }).ready).toBe(false);
    const gateway = { kind: "gateway" as const, hasCredentials: true, hasEndpoint: true };
    expect(assessReadiness({ settings: live, provider: gateway, encryptionAvailable: true, customers: [customer()] }).ready).toBe(true);
    const noKey = assessReadiness({ settings: live, provider: gateway, encryptionAvailable: false, customers: [customer()] });
    expect(noKey.checks.find((c) => c.key === "provider")?.detail).toMatch(/APP_ENCRYPTION_KEY/);
  });

  it("caps the customer list at 50 but reports the true total", () => {
    const many = Array.from({ length: 80 }, (_, i) => customer({ id: `c${i}`, trn: null }));
    const report = assessReadiness({ settings: tenantSettings(), provider: sandbox, encryptionAvailable: true, customers: many });
    expect(report.customerIssues).toHaveLength(50);
    expect(report.customerIssueTotal).toBe(80);
  });
});

describe("request schemas", () => {
  it("accepts a partial settings update and rejects bad values", () => {
    expect(UpdateEinvoiceSettingsSchema.parse({ enabled: true, mode: "sandbox", startDate: "2027-01-01" })).toMatchObject({ enabled: true });
    expect(UpdateEinvoiceSettingsSchema.parse({ startDate: null, endpoint: null, legalRegistration: null })).toEqual({ startDate: null, endpoint: null, legalRegistration: null });
    expect(() => UpdateEinvoiceSettingsSchema.parse({ mode: "production" })).toThrow();
    expect(() => UpdateEinvoiceSettingsSchema.parse({ startDate: "2027-02-30" })).toThrow();
    expect(() => UpdateEinvoiceSettingsSchema.parse({ startDate: "01/01/2027" })).toThrow();
    expect(() => UpdateEinvoiceSettingsSchema.parse({ endpoint: { scheme: "UAE", id: "1" } })).toThrow();
    expect(() => UpdateEinvoiceSettingsSchema.parse({ legalRegistration: { id: "1", type: "XX", authority: "a" } })).toThrow();
    expect(() => UpdateEinvoiceSettingsSchema.parse({ legalRegistration: { id: "1\n2", type: "TL", authority: "a" } })).toThrow();
  });

  it("keeps credentials optional on a provider update and refuses control characters", () => {
    expect(UpdateProviderSchema.parse({ provider: "gateway", endpointUrl: "https://asp.example/v1" }).credentials).toBeUndefined();
    expect(() => UpdateProviderSchema.parse({ provider: "gateway", credentials: "abc\ndef12345" })).toThrow();
    expect(() => UpdateProviderSchema.parse({ provider: "gateway", credentials: "short" })).toThrow();
    expect(() => UpdateProviderSchema.parse({ provider: "carrier-pigeon" })).toThrow();
  });

  it("bounds the register's paging and filters", () => {
    expect(ListDocumentsSchema.parse({})).toMatchObject({ page: 1, pageSize: 25 });
    expect(() => ListDocumentsSchema.parse({ pageSize: 500 })).toThrow();
    expect(() => ListDocumentsSchema.parse({ status: "unknown" })).toThrow();
    expect(ListDocumentsSchema.parse({ status: "rejected", type: "credit_note", q: " INV " }).q).toBe("INV");
  });

  it("reads a callback body strictly", () => {
    expect(CallbackBodySchema.parse({ id: 12, status: "delivered" })).toEqual({ id: "12", status: "delivered" });
    expect(() => CallbackBodySchema.parse({ id: "a", status: "pending" })).toThrow();
    expect(() => CallbackBodySchema.parse({ status: "delivered" })).toThrow();
  });
});
