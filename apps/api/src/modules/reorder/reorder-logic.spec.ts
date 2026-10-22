import { describe, expect, it } from "vitest";
import { chooseSupplier, estimateUnitCost, suggestQuantity, trim } from "./reorder-logic.js";
import { Money } from "@devsfleet/shared-utils";

const base = { incoming: "0", reorderQuantity: "0", allowsFractions: false };

describe("suggestQuantity", () => {
  it("refills to twice the threshold when no order size is set", () => {
    expect(suggestQuantity({ ...base, available: "3", threshold: "10" })).toEqual({
      quantity: "17",
      coveredByIncoming: false,
    });
  });

  it("orders the usual size when one is set", () => {
    expect(suggestQuantity({ ...base, available: "3", threshold: "10", reorderQuantity: "50" }).quantity).toBe("50");
  });

  it("orders the usual size as many times as it takes to clear the threshold", () => {
    expect(suggestQuantity({ ...base, available: "0", threshold: "120", reorderQuantity: "50" }).quantity).toBe("150");
  });

  it("orders one batch when sitting exactly on the threshold", () => {
    expect(suggestQuantity({ ...base, available: "10", threshold: "10", reorderQuantity: "24" }).quantity).toBe("24");
  });

  it("subtracts what is already on its way", () => {
    expect(suggestQuantity({ ...base, available: "2", threshold: "10", incoming: "5" }).quantity).toBe("13");
  });

  it("suggests nothing when incoming stock already clears the threshold", () => {
    expect(suggestQuantity({ ...base, available: "2", threshold: "10", incoming: "20" })).toEqual({
      quantity: "0",
      coveredByIncoming: true,
    });
  });

  it("rounds pieces up to a whole unit", () => {
    expect(suggestQuantity({ ...base, available: "2.5", threshold: "4" }).quantity).toBe("6");
  });

  it("keeps fractions for units that allow them, without float drift", () => {
    expect(
      suggestQuantity({ ...base, allowsFractions: true, available: "37.4", threshold: "37.5" }).quantity,
    ).toBe("37.6");
  });

  it("counts negative stock (oversold) as a bigger deficit", () => {
    expect(suggestQuantity({ ...base, available: "-4", threshold: "10" }).quantity).toBe("24");
  });
});

describe("chooseSupplier", () => {
  const link = (supplierId: string, day: number) => ({ supplierId, updatedAt: new Date(2026, 9, day) });

  it("prefers the supplier last ordered from when still linked", () => {
    expect(chooseSupplier([link("a", 20), link("b", 1)], "b")).toBe("b");
  });

  it("falls back to the only link", () => {
    expect(chooseSupplier([link("a", 1)], null)).toBe("a");
  });

  it("falls back to the most recently updated link among several", () => {
    expect(chooseSupplier([link("a", 1), link("b", 9)], "z")).toBe("b");
  });

  it("uses the last supplier even without a link", () => {
    expect(chooseSupplier([], "z")).toBe("z");
  });

  it("leaves it to the operator when there is no evidence", () => {
    expect(chooseSupplier([], null)).toBeNull();
  });
});

describe("estimateUnitCost", () => {
  const none = { linkCost: null, lastPaidToSupplier: null, lastPaid: null, listPurchasePrice: null, averageCost: null };

  it("takes the most specific evidence first", () => {
    expect(estimateUnitCost({ ...none, linkCost: "4.2", lastPaid: "3.9", averageCost: "3" })).toBe("4.2000");
  });

  it("skips zero placeholders", () => {
    expect(estimateUnitCost({ ...none, linkCost: "0", listPurchasePrice: "7.5" })).toBe("7.5000");
  });

  it("is null when nothing is known", () => {
    expect(estimateUnitCost(none)).toBeNull();
  });
});

describe("trim", () => {
  it("drops trailing zeros and a bare point", () => {
    expect(trim(Money.toMinor("12.5000"))).toBe("12.5");
    expect(trim(Money.toMinor("3"))).toBe("3");
    expect(trim(Money.toMinor("0"))).toBe("0");
  });
});
