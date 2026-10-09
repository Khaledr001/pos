import { describe, expect, it } from "vitest";
import {
  MAX_HELD_CARTS,
  addHeldCart,
  heldAgo,
  heldCartsKey,
  parseHeldCarts,
  reconcileHeldLines,
  removeHeldCart,
  serializeHeldCarts,
  type HeldCart,
  type HeldLine,
  type HeldUnit,
  type HeldVariant,
} from "./held-carts";

const variant = (over: Partial<HeldVariant> = {}): HeldVariant => ({
  id: "v1",
  productId: "p1",
  sku: "SKU1",
  barcode: null,
  productName: "Cable",
  variantName: null,
  unitAbbr: "m",
  categoryName: null,
  taxRate: null,
  stock: "100",
  sellingPrice: "2.5000",
  minSellingPrice: null,
  ...over,
});

const roll: HeldUnit = {
  id: "u1",
  unitId: "roll",
  unitName: "Roll",
  unitAbbr: "roll",
  conversionFactor: "50",
  priceOverride: null,
  isSellable: true,
};

const line = (over: Partial<HeldLine> = {}): HeldLine => ({
  variant: variant(),
  quantity: "2",
  unit: null,
  unitPrice: "2.5000",
  discountPercent: "0",
  ...over,
});

const cart = (id: string, over: Partial<HeldCart> = {}): HeldCart => ({
  id,
  heldAt: "2026-01-01T10:00:00.000Z",
  clientId: `client-${id}`,
  branchId: "b1",
  customer: null,
  lines: [line()],
  documentDiscount: "0",
  notes: "",
  total: "5.00",
  ...over,
});

// Stand-ins for the page's Money-based helpers.
const listPriceFor = (v: HeldVariant, u: HeldUnit | null) =>
  u ? String(Number(v.sellingPrice) * Number(u.conversionFactor)) : v.sellingPrice;
const sameMoney = (a: string, b: string) => Number(a || 0) === Number(b || 0);
const reconcile = (
  lines: HeldLine[],
  fresh: HeldVariant[],
  units: Record<string, HeldUnit[]> = {},
) =>
  reconcileHeldLines(
    lines,
    new Map(fresh.map((v) => [v.id, v])),
    new Map(Object.entries(units)),
    listPriceFor,
    sameMoney,
  );

describe("storage key", () => {
  it("is scoped by tenant, user and branch", () => {
    expect(heldCartsKey("t", "u", "b")).toBe("devsfleet_sell_held:v1:t:u:b");
    expect(heldCartsKey("t", "u", "b")).not.toBe(heldCartsKey("t", "u", "b2"));
    expect(heldCartsKey("t", "u", "b")).not.toBe(heldCartsKey("t", "u2", "b"));
  });
});

describe("parse / serialise", () => {
  it("round-trips, keeping each cart's own clientId", () => {
    const carts = [cart("a"), cart("b")];
    const back = parseHeldCarts(serializeHeldCarts(carts));
    expect(back).toEqual(carts);
    expect(back.map((c) => c.clientId)).toEqual(["client-a", "client-b"]);
  });

  it.each([null, undefined, "", "not json", "{}", "[]", '{"v":2,"carts":[]}', '{"v":1}', "null"])(
    "ignores unusable input %j",
    (raw) => {
      expect(parseHeldCarts(raw as string | null)).toEqual([]);
    },
  );

  it("drops a malformed cart but keeps its neighbours", () => {
    const bad = { ...cart("bad"), lines: [{ nope: true }] };
    const raw = JSON.stringify({ v: 1, carts: [cart("a"), bad, cart("c")] });
    expect(parseHeldCarts(raw).map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("rejects non-decimal numeric text that would crash Money.toMinor", () => {
    const evil = cart("x", { lines: [line({ quantity: "1e9; drop" })] });
    expect(parseHeldCarts(serializeHeldCarts([evil]))).toEqual([]);
  });

  it("rejects a cart with no clientId or no lines", () => {
    expect(parseHeldCarts(serializeHeldCarts([cart("a", { clientId: "" })]))).toEqual([]);
    expect(parseHeldCarts(serializeHeldCarts([cart("a", { lines: [] })]))).toEqual([]);
  });

  it("collapses duplicate ids and caps the list", () => {
    expect(parseHeldCarts(serializeHeldCarts([cart("a"), cart("a")]))).toHaveLength(1);
    const many = Array.from({ length: MAX_HELD_CARTS + 5 }, (_, i) => cart(`c${i}`));
    expect(parseHeldCarts(serializeHeldCarts(many))).toHaveLength(MAX_HELD_CARTS);
  });
});

describe("add / remove", () => {
  it("puts the newest first", () => {
    const res = addHeldCart([cart("a")], cart("b"));
    expect(res.ok && res.carts.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("refuses when full and when empty, leaving the list untouched", () => {
    const full = Array.from({ length: MAX_HELD_CARTS }, (_, i) => cart(`c${i}`));
    expect(addHeldCart(full, cart("new"))).toEqual({ ok: false, reason: "full" });
    expect(addHeldCart([], cart("e", { lines: [] }))).toEqual({ ok: false, reason: "empty" });
  });

  it("removes by id", () => {
    expect(removeHeldCart([cart("a"), cart("b")], "a").map((c) => c.id)).toEqual(["b"]);
  });
});

describe("reconcileHeldLines", () => {
  it("drops lines whose product is gone or out of stock, with a notice", () => {
    const res = reconcile(
      [line(), line({ variant: variant({ id: "v2", productName: "Pipe" }) })],
      [variant({ stock: "0" })],
    );
    expect(res.lines).toEqual([]);
    expect(res.notices).toHaveLength(2);
    expect(res.notices[0]).toMatch(/out of stock/);
    expect(res.notices[1]).toMatch(/no longer available/);
  });

  it("re-prices a list-price line to the current list", () => {
    const res = reconcile([line()], [variant({ sellingPrice: "3.0000" })]);
    expect(res.lines[0]!.unitPrice).toBe("3.0000");
    expect(res.notices[0]).toMatch(/price updated/);
  });

  it("keeps a deliberate override but says list moved", () => {
    const res = reconcile([line({ unitPrice: "2.0000" })], [variant({ sellingPrice: "3.0000" })]);
    expect(res.lines[0]!.unitPrice).toBe("2.0000");
    expect(res.notices[0]).toMatch(/custom price was kept/);
  });

  it("is silent when nothing changed", () => {
    const res = reconcile([line()], [variant()]);
    expect(res.notices).toEqual([]);
    expect(res.lines[0]!.quantity).toBe("2");
  });

  it("clamps quantity to current stock, scaled by packaging", () => {
    expect(reconcile([line({ quantity: "5" })], [variant({ stock: "3" })]).lines[0]!.quantity).toBe("3");
    const packed = line({ unit: roll, quantity: "4", unitPrice: "125" });
    const res = reconcile([packed], [variant({ stock: "100" })], { v1: [roll] });
    expect(res.lines[0]!.quantity).toBe("2");
    expect(res.notices.join(" ")).toMatch(/reduced to 2/);
  });

  it("falls back to the base unit when the packaging is withdrawn", () => {
    const packed = line({ unit: roll, quantity: "1", unitPrice: "125" });
    const res = reconcile([packed], [variant()], { v1: [] });
    expect(res.lines[0]!.unit).toBeNull();
    expect(res.lines[0]!.unitPrice).toBe("2.5000");
  });

  it("keeps the parked packaging when units could not be read", () => {
    const packed = line({ unit: roll, quantity: "1", unitPrice: "125" });
    expect(reconcile([packed], [variant()]).lines[0]!.unit).toEqual(roll);
  });
});

describe("heldAgo", () => {
  const t = Date.parse("2026-01-01T12:00:00Z");
  it("reads naturally", () => {
    expect(heldAgo("2026-01-01T12:00:00Z", t)).toBe("just now");
    expect(heldAgo("2026-01-01T11:55:00Z", t)).toBe("5 min ago");
    expect(heldAgo("2026-01-01T10:00:00Z", t)).toBe("2 hours ago");
    expect(heldAgo("2025-12-29T12:00:00Z", t)).toBe("3 days ago");
  });
});
