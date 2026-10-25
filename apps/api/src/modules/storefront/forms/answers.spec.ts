import type { FormField } from "@devsfleet/shared-types";
import { describe, expect, it } from "vitest";
import { validateAnswers } from "./answers.js";

const fields: FormField[] = [
  { key: "name", type: "text", label: "Your name", required: true, role: "name" },
  { key: "email", type: "email", label: "Email", required: false, role: "email" },
  { key: "phone", type: "phone", label: "Phone", required: false, role: "phone" },
  { key: "topic", type: "select", label: "Topic", required: true, options: ["Sales", "Support"] },
  { key: "qty", type: "number", label: "Quantity", required: false },
  { key: "when", type: "date", label: "Needed by", required: false },
  { key: "message", type: "textarea", label: "Message", required: false },
  { key: "agree", type: "checkbox", label: "Contact me back", required: false },
];

const ok = { name: "Sara", topic: "Sales" };

describe("validateAnswers", () => {
  it("accepts a minimal valid submission and returns answers in the form's field order", () => {
    const result = validateAnswers(fields, { topic: "Support", name: " Sara " });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.answers.map((a) => a.key)).toEqual(["name", "topic"]);
    expect(result.value.answers[0]).toEqual({ key: "name", label: "Your name", value: "Sara" });
    expect(result.value.name).toBe("Sara");
    expect(result.value.email).toBeNull();
  });

  it("extracts name, email and phone by role", () => {
    const result = validateAnswers(fields, { ...ok, email: "SARA@Example.com", phone: "+971501234567" });
    expect(result.ok && result.value).toMatchObject({ name: "Sara", email: "sara@example.com", phone: "+971501234567" });
  });

  it("reports each problem against its own field", () => {
    const result = validateAnswers(fields, { email: "nope", phone: "12", topic: "Other", qty: "ten", when: "2026-02-30" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(["email", "name", "phone", "qty", "topic", "when"]);
  });

  it("requires what is required, and treats blanks as missing", () => {
    const result = validateAnswers(fields, { name: "   ", topic: "" });
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(["name", "topic"]);
  });

  it("ignores keys the form does not define", () => {
    const result = validateAnswers(fields, { ...ok, isAdmin: true, "__proto__": "x", extra: "<script>" });
    expect(result.ok && result.value.answers.map((a) => a.key)).toEqual(["name", "topic"]);
  });

  it("checks a dropdown against its options, exactly", () => {
    expect(validateAnswers(fields, { ...ok, topic: "sales" }).ok).toBe(false);
    expect(validateAnswers(fields, { ...ok, topic: "Sales" }).ok).toBe(true);
  });

  it("validates numbers and dates", () => {
    expect(validateAnswers(fields, { ...ok, qty: "12.5", when: "2026-12-31" }).ok).toBe(true);
    expect(validateAnswers(fields, { ...ok, qty: "1e9" }).ok).toBe(false);
    expect(validateAnswers(fields, { ...ok, qty: 12 }).ok).toBe(true);
    expect(validateAnswers(fields, { ...ok, when: "31/12/2026" }).ok).toBe(false);
  });

  it("records a checkbox as Yes or No, and can require it", () => {
    const yes = validateAnswers(fields, { ...ok, agree: true });
    expect(yes.ok && yes.value.answers.find((a) => a.key === "agree")?.value).toBe("Yes");
    const no = validateAnswers(fields, { ...ok, agree: false });
    expect(no.ok && no.value.answers.find((a) => a.key === "agree")?.value).toBe("No");
    const required: FormField[] = [{ key: "terms", type: "checkbox", label: "Terms", required: true }];
    expect(validateAnswers(required, { terms: false }).ok).toBe(false);
    expect(validateAnswers(required, { terms: true }).ok).toBe(true);
  });

  it("caps a value at 2000 characters", () => {
    expect(validateAnswers(fields, { ...ok, message: "x".repeat(2000) }).ok).toBe(true);
    expect(validateAnswers(fields, { ...ok, message: "x".repeat(2001) }).ok).toBe(false);
  });

  it("strips control characters, keeps line breaks in a text area only", () => {
    const result = validateAnswers(fields, { name: "Sa\u0000ra\nBcc: evil@x.test", topic: "Sales", message: "line1\r\nline2\u0007" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("Sara Bcc: evil@x.test");
    expect(result.value.answers.find((a) => a.key === "message")?.value).toBe("line1\nline2");
  });

  it("never stores markup as anything but text (escaping is the renderers' job, the value is kept as typed)", () => {
    const result = validateAnswers(fields, { ...ok, message: "<img src=x onerror=alert(1)>" });
    expect(result.ok && result.value.answers.find((a) => a.key === "message")?.value).toBe("<img src=x onerror=alert(1)>");
  });
});
