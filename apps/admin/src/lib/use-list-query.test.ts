import { describe, expect, it } from "vitest";
import { readListResult } from "./use-list-query";
import { paginationRange } from "@/components/ui/data-table";

describe("readListResult", () => {
  it("reads the paginated envelope's meta total", () => {
    // What apiFetch hands back for a paginated envelope: the data array, with
    // `items` pointing at itself and `meta` hung off it.
    const res = Object.assign([{ id: 1 }], { meta: { total: 40 } });
    const { items, total } = readListResult<{ id: number }>(res);
    expect(total).toBe(40);
    expect(items.map((i) => i.id)).toEqual([1]);
  });

  it("reads { items, total }", () => {
    expect(readListResult({ items: [{ id: 1 }, { id: 2 }], total: 9 })).toEqual({
      items: [{ id: 1 }, { id: 2 }],
      total: 9,
    });
  });

  it("falls back to the length of a bare array", () => {
    expect(readListResult([{ id: 1 }])).toEqual({ items: [{ id: 1 }], total: 1 });
  });

  it("survives an empty answer", () => {
    expect(readListResult(undefined)).toEqual({ items: [], total: 0 });
  });
});

describe("paginationRange", () => {
  it("lists every page when there are few", () => {
    expect(paginationRange(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("elides both sides around the current page", () => {
    expect(paginationRange(10, 42)).toEqual([1, "ellipsis", 9, 10, 11, "ellipsis", 42]);
  });
});
