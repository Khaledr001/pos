import { DEFAULT_TENANT_SETTINGS, type TenantSettings } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { describe, expect, it } from "vitest";
import { checkedLegalAddress, checkedSubdivision, uaeSubdivision } from "./party.js";
import { checkedTaxId, fieldError, isUaeTenant } from "./tenant-region.js";

const uae = DEFAULT_TENANT_SETTINGS;
const saudi: TenantSettings = {
  ...DEFAULT_TENANT_SETTINGS,
  currency: { ...DEFAULT_TENANT_SETTINGS.currency, base: "SAR" },
  locale: { ...DEFAULT_TENANT_SETTINGS.locale, timezone: "Asia/Riyadh" },
};

describe("isUaeTenant", () => {
  it("is the UAE by timezone or by books currency", () => {
    expect(isUaeTenant(uae)).toBe(true);
    expect(isUaeTenant({ ...saudi, currency: { ...saudi.currency, base: "AED" } })).toBe(true);
    expect(isUaeTenant({ ...saudi, locale: { ...saudi.locale, timezone: "Asia/Dubai" } })).toBe(true);
    expect(isUaeTenant(saudi)).toBe(false);
  });
});

describe("checkedTaxId", () => {
  it("blank is allowed and means none", () => {
    expect(checkedTaxId("", uae, "trn")).toBeNull();
    expect(checkedTaxId("   ", uae, "trn")).toBeNull();
    expect(checkedTaxId(undefined, uae, "trn")).toBeNull();
  });

  it("a UAE TRN is 15 digits starting 100, stored without spaces or dashes", () => {
    expect(checkedTaxId("100 2345-6780 0003", uae, "trn")).toBe("100234567800003");
    expect(checkedTaxId("100234567800003", uae, "trn")).toBe("100234567800003");
  });

  it.each(["123", "200234567800003", "10023456780000", "1002345678000033", "abc234567800003"])("refuses %s in the UAE", (bad) => {
    expect(() => checkedTaxId(bad, uae, "trn")).toThrow(AppError);
  });

  it("the refusal names the field in the shape the forms render", () => {
    try {
      checkedTaxId("123", uae, "trn");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect((e as AppError).details).toEqual({ fields: { trn: ["A UAE TRN is 15 digits starting with 100"] } });
    }
  });

  it("other countries get a lenient shape, upper-cased", () => {
    expect(checkedTaxId("gb 123-456", saudi, "trn")).toBe("GB123456");
    expect(() => checkedTaxId("12", saudi, "trn")).toThrow(AppError);
  });
});

describe("fieldError", () => {
  it("is a business refusal (permanent for the offline sync) carrying field details", () => {
    const e = fieldError("legalAddress.city", "Required");
    expect(e).toBeInstanceOf(AppError);
    expect(e.details).toEqual({ fields: { "legalAddress.city": ["Required"] } });
  });
});

describe("emirates", () => {
  it("accepts a code, a zone code or a name in any case", () => {
    expect(uaeSubdivision("dxb")).toBe("DXB");
    expect(uaeSubdivision("DUBAI")).toBe("DXB");
    expect(uaeSubdivision("abu dhabi")).toBe("AUH");
    expect(uaeSubdivision("Ras Al Khaimah")).toBe("RAK");
    expect(uaeSubdivision("Atlantis")).toBeNull();
  });

  it("is required to be an emirate for a UAE address, free text elsewhere, blank is none", () => {
    expect(checkedSubdivision("Dubai", "AE", "addressSubdivision")).toBe("DXB");
    expect(() => checkedSubdivision("Riyadh", "AE", "addressSubdivision")).toThrow(AppError);
    expect(checkedSubdivision("Riyadh Region", "SA", "addressSubdivision")).toBe("Riyadh Region");
    expect(checkedSubdivision("", "AE", "addressSubdivision")).toBeNull();
    expect(checkedSubdivision(null, "AE", "addressSubdivision")).toBeNull();
  });
});

describe("checkedLegalAddress", () => {
  it("normalises the emirate and the country", () => {
    expect(
      checkedLegalAddress({ line1: " Shop 4 ", city: " Sharjah ", subdivision: "sharjah", countryCode: "ae", postalCode: " " }),
    ).toEqual({ line1: "Shop 4", city: "Sharjah", subdivision: "SHJ", countryCode: "AE" });
  });

  it("refuses a UAE address that names no valid emirate", () => {
    expect(() => checkedLegalAddress({ line1: "x", city: "y", subdivision: "Narnia", countryCode: "AE" })).toThrow(/emirate/i);
  });
});
