import { describe, expect, it } from "vitest";
import { checkStorefrontHostname, subdomainLabelProblem, suggestSubdomainLabel } from "./platform-subdomain.js";

describe("checkStorefrontHostname", () => {
  const base = "devsfleet.com";

  it("accepts a single, ordinary label on the platform domain", () => {
    expect(checkStorefrontHostname("allahiq.devsfleet.com", base)).toEqual({ ok: true });
  });

  it("refuses the platform's own hosts", () => {
    for (const host of ["pos.devsfleet.com", "pos-api.devsfleet.com", "api.devsfleet.com", "cdn.devsfleet.com", "www.devsfleet.com"]) {
      expect(checkStorefrontHostname(host, base).ok).toBe(false);
    }
  });

  it("refuses the bare base domain", () => {
    expect(checkStorefrontHostname("devsfleet.com", base).ok).toBe(false);
  });

  it("refuses nested names under the platform domain", () => {
    expect(checkStorefrontHostname("shop.allahiq.devsfleet.com", base).ok).toBe(false);
  });

  it("refuses labels that are too short or badly formed", () => {
    expect(checkStorefrontHostname("ab.devsfleet.com", base).ok).toBe(false);
    expect(checkStorefrontHostname("-shop.devsfleet.com", base).ok).toBe(false);
    expect(checkStorefrontHostname("shop-.devsfleet.com", base).ok).toBe(false);
  });

  it("leaves a tenant's own domain alone", () => {
    expect(checkStorefrontHostname("shop.allahiq.ae", base)).toEqual({ ok: true });
    // A look-alike domain is not the platform domain.
    expect(checkStorefrontHostname("pos.notdevsfleet.com", base)).toEqual({ ok: true });
  });

  it("restricts nothing when no base domain is configured", () => {
    expect(checkStorefrontHostname("pos.devsfleet.com", undefined)).toEqual({ ok: true });
  });

  it("compares case-insensitively", () => {
    expect(checkStorefrontHostname("POS.DevsFleet.com", "DevsFleet.com").ok).toBe(false);
  });
});

describe("subdomainLabelProblem", () => {
  it("explains each refusal", () => {
    expect(subdomainLabelProblem("allahiq")).toBeNull();
    expect(subdomainLabelProblem("pos")).toMatch(/reserved/i);
    expect(subdomainLabelProblem("a".repeat(41))).toMatch(/40/);
    expect(subdomainLabelProblem("al_lahiq")).toMatch(/lowercase/i);
  });
});

describe("suggestSubdomainLabel", () => {
  it("turns a business name into an address", () => {
    expect(suggestSubdomainLabel("AL Lahiq Elect. & Sanitary Ware Trdg.")).toBe("al-lahiq-elect-sanitary-ware-trdg");
  });

  it("stays within the length limit on a word boundary", () => {
    const label = suggestSubdomainLabel("Very Long Business Name For A Hardware And Electrical Trading Company");
    expect(label.length).toBeLessThanOrEqual(40);
    expect(label.endsWith("-")).toBe(false);
  });
});
