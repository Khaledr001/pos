import { describe, expect, it } from "vitest";
import { ListSerialsSchema } from "./dto.js";

describe("ListSerialsSchema", () => {
  it("defaults to the newest receipts first, one page", () => {
    const parsed = ListSerialsSchema.parse({});
    expect(parsed).toMatchObject({ sortBy: "createdAt", sortOrder: "desc", page: 1 });
    expect(parsed.limit).toBeGreaterThan(0);
  });

  it("accepts the filters the admin page sends", () => {
    const parsed = ListSerialsSchema.parse({
      q: " SN-1 ",
      status: "sold",
      productId: "6f9619ff-8b86-4011-b42d-00cf4fc964ff",
      page: "2",
      sortBy: "expiryDate",
      sortOrder: "asc",
    });
    expect(parsed).toMatchObject({ q: "SN-1", status: "sold", page: 2, sortBy: "expiryDate" });
  });

  it("refuses a column the list does not sort by, and an unknown status", () => {
    expect(ListSerialsSchema.safeParse({ sortBy: "tenantId" }).success).toBe(false);
    expect(ListSerialsSchema.safeParse({ status: "lost" }).success).toBe(false);
  });
});
