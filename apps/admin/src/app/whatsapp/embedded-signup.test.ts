import { describe, expect, it } from "vitest";
import { readSessionEvent } from "./embedded-signup";

const meta = (data: unknown, origin = "https://www.facebook.com") => ({ origin, data });
const event = (name: string, data: Record<string, string> = {}) =>
  JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: name, data });

describe("readSessionEvent", () => {
  it("reads the chosen number from a finished signup, string or object payload", () => {
    const expected = { kind: "finish", wabaId: "111", phoneNumberId: "555" };
    expect(readSessionEvent(meta(event("FINISH", { waba_id: "111", phone_number_id: "555" })))).toEqual(expected);
    expect(
      readSessionEvent(meta({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", data: { waba_id: "111", phone_number_id: "555" } })),
    ).toEqual(expected);
  });

  it("ignores the same message from any origin that isn't Meta's", () => {
    const data = event("FINISH", { waba_id: "111", phone_number_id: "555" });
    expect(readSessionEvent(meta(data, "https://evil.example"))).toBeNull();
    expect(readSessionEvent(meta(data, "https://facebook.com.evil.example"))).toBeNull();
    expect(readSessionEvent(meta(data, "http://www.facebook.com"))).toBeNull();
  });

  it("reports where a signup was abandoned, and Meta's errors", () => {
    expect(readSessionEvent(meta(event("CANCEL", { current_step: "PHONE_NUMBER_SETUP" })))).toEqual({ kind: "cancel", step: "PHONE_NUMBER_SETUP" });
    expect(readSessionEvent(meta(event("ERROR", { error_message: "Session expired" })))).toEqual({ kind: "error", message: "Session expired" });
  });

  it("treats a finish without a number as incomplete", () => {
    expect(readSessionEvent(meta(event("FINISH_ONLY_WABA", { waba_id: "111" })))).toEqual({ kind: "incomplete" });
  });

  it("ignores unrelated messages", () => {
    expect(readSessionEvent(meta("not json"))).toBeNull();
    expect(readSessionEvent(meta({ type: "SOMETHING_ELSE" }))).toBeNull();
  });
});
