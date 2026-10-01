import { describe, expect, it } from "vitest";
import { canTransition, nextStatuses } from "./web-order-status.js";

describe("web order lifecycle", () => {
  it("moves forward, skipping steps when the shop does", () => {
    expect(canTransition("placed", "confirmed", "courier")).toBe(true);
    expect(canTransition("placed", "packed", "courier")).toBe(true);
    expect(canTransition("confirmed", "delivered", "courier")).toBe(true);
  });

  it("never moves backwards", () => {
    expect(canTransition("packed", "confirmed", "courier")).toBe(false);
    expect(canTransition("delivered", "shipped", "courier")).toBe(false);
  });

  it("keeps courier and pickup steps apart", () => {
    expect(canTransition("packed", "ready_for_pickup", "courier")).toBe(false);
    expect(canTransition("packed", "shipped", "pickup")).toBe(false);
    expect(canTransition("ready_for_pickup", "collected", "pickup")).toBe(true);
  });

  it("leaves an unpaid order alone — only a payment releases it", () => {
    expect(canTransition("pending_payment", "placed", "courier")).toBe(false);
    expect(canTransition("pending_payment", "confirmed", "courier")).toBe(false);
    expect(canTransition("pending_payment", "cancelled", "courier")).toBe(true);
  });

  it("cannot cancel what has already left the shelf", () => {
    expect(canTransition("shipped", "cancelled", "courier")).toBe(false);
    expect(canTransition("delivered", "cancelled", "courier")).toBe(false);
    expect(canTransition("collected", "cancelled", "pickup")).toBe(false);
  });

  it("never refunds through a status change", () => {
    expect(canTransition("cancelled", "refunded", "courier")).toBe(false);
  });

  it("offers the order desk only legal next steps", () => {
    expect(nextStatuses("shipped", "courier")).toEqual(["delivered"]);
    expect(nextStatuses("delivered", "courier")).toEqual([]);
    expect(nextStatuses("packed", "pickup")).toEqual(["ready_for_pickup", "collected", "cancelled"]);
  });
});
