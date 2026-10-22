import { describe, expect, it } from "vitest";
import { describeRange, placePopover, presetRange } from "./date-range-picker";

const anchor = (left: number, top: number, width = 250, height = 40) => ({
  left,
  right: left + width,
  top,
  bottom: top + height,
});

describe("placePopover", () => {
  it("opens below and from the start edge when there is room", () => {
    expect(placePopover(anchor(100, 100), 740, 420, 1280, 800)).toEqual({ left: 100, top: 148 });
  });

  it("lines up with the far edge instead of running off the right", () => {
    // A picker at the right of a filter row: 1000 + 740 would end at 1740.
    const p = placePopover(anchor(1000, 100), 740, 420, 1280, 800);
    expect(p.left).toBe(1250 - 740);
    expect(p.left + 740).toBeLessThanOrEqual(1280 - 8);
  });

  it("is clamped inside the window when neither edge fits", () => {
    const p = placePopover(anchor(300, 100, 100), 700, 420, 720, 800);
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.left + 700).toBeLessThanOrEqual(720 - 8);
  });

  it("opens above when there is no room below", () => {
    expect(placePopover(anchor(100, 600), 740, 420, 1280, 800).top).toBe(600 - 8 - 420);
  });

  it("pins inside the window, scrollable, when it fits neither way", () => {
    const p = placePopover(anchor(100, 300), 500, 700, 800, 600);
    expect(p.maxHeight).toBe(600 - 16);
    expect(p.top).toBeGreaterThanOrEqual(8);
  });
});

describe("presets", () => {
  const today = new Date(2026, 9, 22);

  it("computes calendar periods on the local calendar", () => {
    expect(presetRange("last-month", today)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetRange("last-7", today)).toEqual({ from: "2026-10-16", to: "2026-10-22" });
    expect(presetRange("all", today)).toEqual({ from: "", to: "" });
  });

  it("names a range that matches a preset", () => {
    expect(describeRange(presetRange("this-month", today), today)).toBe("This Month");
    expect(describeRange({ from: "", to: "" }, today)).toBe("All Time");
  });
});
