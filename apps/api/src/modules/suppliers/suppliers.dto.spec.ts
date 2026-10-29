import { describe, expect, it } from "vitest";
import { CreateSupplierSchema, UpdateSupplierSchema } from "./dto.js";

describe("supplier DTOs", () => {
  it("a new supplier starts on cash terms", () => {
    expect(CreateSupplierSchema.parse({ name: "Gulf Pipes LLC" }).paymentTermDays).toBe(0);
  });

  it("an update carries only what was sent — it must not reset a supplier's payment terms", () => {
    expect(UpdateSupplierSchema.parse({ phone: "+971501234567" })).toEqual({ phone: "+971501234567" });
    expect(UpdateSupplierSchema.parse({})).toEqual({});
  });
});
