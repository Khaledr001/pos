import { describe, expect, it } from "vitest";
import type { Response } from "express";
import { RequestContext } from "../../../common/context/request-context.js";
import type { TenantDatabase } from "../../../database/tenant-database.service.js";
import { LeadsAdminService } from "./leads-admin.service.js";

const record = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  formSlug: "contact",
  formName: "Contact us",
  status: "new",
  name: "Sara",
  email: "sara@example.com",
  phone: "+971501234567",
  answers: [{ label: "Message", value: "Hello" }],
  sourcePath: "/pages/contact",
  productName: "Mixer tap",
  productSku: "TAP-1",
  notes: "",
  contentHash: "secret-hash",
  ipHash: "secret-ip",
  createdAt: new Date("2026-10-25T10:00:00Z"),
  updatedAt: new Date("2026-10-25T10:05:00Z"),
  ...over,
});

interface Seed {
  items?: ReturnType<typeof record>[];
  total?: number;
  grouped?: { status: string; n: number }[];
  found?: ReturnType<typeof record> | undefined;
}

function setup(seed: Seed = {}) {
  const updates: Record<string, unknown>[] = [];
  const deletes: unknown[] = [];
  const found = "found" in seed ? seed.found : record();
  const select = (arg?: Record<string, unknown>) => {
    const rows = !arg ? (seed.items ?? []) : "status" in arg ? (seed.grouped ?? []) : [{ n: seed.total ?? (seed.items ?? []).length }];
    const builder: Record<string, unknown> = {};
    for (const method of ["from", "where", "orderBy", "limit", "offset", "groupBy"]) builder[method] = () => builder;
    builder.then = (resolve: (v: unknown) => unknown) => resolve(rows);
    return builder;
  };
  const tx = {
    query: { storefrontLeads: { findFirst: async () => found }, tenants: { findFirst: async () => ({ settings: { locale: { timezone: "Asia/Dubai" } } }) } },
    select,
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: () => ({ returning: async () => (updates.push(v), [record({ ...v })]) }) }) }),
    delete: () => ({ where: async () => void deletes.push(1) }),
  };
  const db = { run: async (fn: (t: unknown) => unknown) => fn(tx) } as unknown as TenantDatabase;
  const service = new LeadsAdminService(db);
  const inTenant = <T>(fn: () => T) => RequestContext.run({ requestId: "t", startedAt: 0, tenantId: "t" } as never, fn);
  return { service, updates, deletes, inTenant };
}

describe("LeadsAdminService", () => {
  it("lists with a count per status and never exposes the hashes", async () => {
    const { service, inTenant } = setup({ items: [record()], total: 1, grouped: [{ status: "new", n: 3 }, { status: "won", n: 1 }] });
    const page = await inTenant(() => service.list({ page: 1, pageSize: 25 }));
    expect(page.total).toBe(1);
    expect(page.counts).toEqual({ new: 3, contacted: 0, qualified: 0, won: 1, lost: 0, spam: 0 });
    expect(page.items[0]).toMatchObject({ formSlug: "contact", source: { path: "/pages/contact", productName: "Mixer tap", productSku: "TAP-1" }, createdAt: "2026-10-25T10:00:00.000Z" });
    expect(JSON.stringify(page)).not.toMatch(/secret-hash|secret-ip|contentHash|ipHash/);
  });

  it("404s on a lead that does not exist", async () => {
    const { service, inTenant } = setup({ found: undefined });
    await expect(inTenant(() => service.get("x"))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(inTenant(() => service.update("x", { status: "won" }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(inTenant(() => service.remove("x"))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("changes only what the request names", async () => {
    const { service, updates, inTenant } = setup();
    await inTenant(() => service.update("x", { status: "contacted" }));
    await inTenant(() => service.update("x", { notes: "Called, call back Tuesday" }));
    expect(updates).toEqual([{ status: "contacted" }, { notes: "Called, call back Tuesday" }]);
  });

  it("deletes a lead", async () => {
    const { service, deletes, inTenant } = setup();
    expect(await inTenant(() => service.remove("x"))).toEqual({ deleted: true });
    expect(deletes).toHaveLength(1);
  });

  describe("export", () => {
    function fakeResponse() {
      const headers: Record<string, string> = {};
      let body: Buffer | undefined;
      const res = { setHeader: (k: string, v: string) => void (headers[k.toLowerCase()] = v), end: (b: Buffer) => void (body = b) } as unknown as Response;
      return { res, headers, text: () => body?.toString("utf8") ?? "" };
    }

    it("writes a CSV with the right headers, the answers in one cell and the visitor's time on the shop's clock", async () => {
      const { service, inTenant } = setup({ items: [record()] });
      const out = fakeResponse();
      await inTenant(() => service.export({}, "csv", out.res));
      expect(out.headers["content-type"]).toContain("text/csv");
      expect(out.headers["content-disposition"]).toMatch(/^attachment; filename="leads_\d{4}-\d{2}-\d{2}\.csv"$/);
      const lines = out.text().replace(/^﻿/, "").split("\r\n");
      expect(lines[0]).toBe("Received,Form,Status,Name,Email,Phone,Product,SKU,Page,Answers,Notes");
      expect(lines[1]).toContain("2026-10-25 14:00");
      expect(lines[1]).toContain("Message: Hello");
      expect(out.text()).not.toMatch(/secret-hash|secret-ip/);
    });

    it("neutralises a cell a spreadsheet would run as a formula", async () => {
      const evil = record({ name: "=HYPERLINK(\"http://evil.test\",\"click\")", email: "+cmd@example.com", notes: "@SUM(1+1)", answers: [{ label: "Message", value: "-2+3" }] });
      const { service, inTenant } = setup({ items: [evil] });
      const out = fakeResponse();
      await inTenant(() => service.export({}, "csv", out.res));
      const csv = out.text();
      expect(csv).toContain("\"'=HYPERLINK(");
      expect(csv).toContain("'+cmd@example.com");
      expect(csv).toContain("'@SUM(1+1)");
      expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    });

    it("quotes commas, quotes and line breaks", async () => {
      const { service, inTenant } = setup({ items: [record({ name: "Smith, \"Bob\"", answers: [{ label: "Message", value: "line1\nline2" }] })] });
      const out = fakeResponse();
      await inTenant(() => service.export({}, "csv", out.res));
      expect(out.text()).toContain("\"Smith, \"\"Bob\"\"\"");
      expect(out.text()).toContain("\"Message: line1\nline2\"");
    });

    it("refuses an export over 10,000 leads", async () => {
      const { service, inTenant } = setup({ items: Array.from({ length: 10_001 }, () => record()) });
      await expect(inTenant(() => service.export({}, "csv", fakeResponse().res))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    });
  });
});
