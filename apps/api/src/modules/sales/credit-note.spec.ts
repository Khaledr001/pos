import { describe, expect, it } from "vitest";
import { resolveCreditNote } from "./credit-note.js";

describe("resolveCreditNote", () => {
  it("a PINT AE reason code is the code, and the note is whatever prose came with it", () => {
    expect(resolveCreditNote({ reason: "VD", reasonNote: "Q4 rebate" })).toEqual({ code: "VD", note: "Q4 rebate" });
    expect(resolveCreditNote({ reason: "DL8.61.1.A" })).toEqual({ code: "DL8.61.1.A", note: null });
  });

  it("a plain sentence from an older client becomes the note, with the code defaulting to goods returned", () => {
    expect(resolveCreditNote({ reason: "Customer changed their mind" })).toEqual({
      code: "DL8.61.1.D",
      note: "Customer changed their mind",
    });
  });

  it("an explicit note wins over a legacy sentence", () => {
    expect(resolveCreditNote({ reason: "old text", reasonNote: "new text" })).toEqual({ code: "DL8.61.1.D", note: "new text" });
  });

  it("nothing at all is goods returned with no note", () => {
    expect(resolveCreditNote({})).toEqual({ code: "DL8.61.1.D", note: null });
    expect(resolveCreditNote({ reason: "   ", reasonNote: "  " })).toEqual({ code: "DL8.61.1.D", note: null });
  });

  it("a code is matched exactly: a lowercase look-alike is just text", () => {
    expect(resolveCreditNote({ reason: "vd" })).toEqual({ code: "DL8.61.1.D", note: "vd" });
  });
});
