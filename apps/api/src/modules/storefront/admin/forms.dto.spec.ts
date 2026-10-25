import { MAX_FORM_FIELDS } from "@devsfleet/shared-types";
import { describe, expect, it } from "vitest";
import { FormSchema, ListLeadsSchema, UpdateFormSchema, UpdateLeadSchema } from "./forms.dto.js";

const base = {
  slug: "contact",
  name: "Contact us",
  fields: [
    { key: "name", type: "text", label: "Name", required: true, role: "name" },
    { key: "email", type: "email", label: "Email", required: true, role: "email" },
    { key: "message", type: "textarea", label: "Message", required: false },
  ],
};

describe("FormSchema", () => {
  it("accepts a form and fills the defaults", () => {
    const parsed = FormSchema.parse(base);
    expect(parsed).toMatchObject({ submitLabel: "Send", acknowledge: true, isActive: true, notifyEmails: [] });
  });

  it("needs at least one field and at most MAX_FORM_FIELDS", () => {
    expect(FormSchema.safeParse({ ...base, fields: [] }).success).toBe(false);
    const field = (i: number) => ({ key: `f${i}`, type: "text", label: "L", required: false });
    expect(FormSchema.safeParse({ ...base, fields: Array.from({ length: MAX_FORM_FIELDS }, (_, i) => field(i)) }).success).toBe(true);
    expect(FormSchema.safeParse({ ...base, fields: Array.from({ length: MAX_FORM_FIELDS + 1 }, (_, i) => field(i)) }).success).toBe(false);
  });

  it("rejects duplicate keys and bad keys", () => {
    const dup = { ...base, fields: [base.fields[0], { ...base.fields[0], role: undefined }] };
    expect(FormSchema.safeParse(dup).success).toBe(false);
    for (const key of ["Name", "1a", "has space", "a-b", "x".repeat(41), "__proto__!"]) {
      expect(FormSchema.safeParse({ ...base, fields: [{ key, type: "text", label: "L", required: false }] }).success, key).toBe(false);
    }
  });

  it("allows one field per role, and the role must fit the field's type", () => {
    const two = { ...base, fields: [base.fields[0], { key: "n2", type: "text", label: "Other", required: false, role: "name" }] };
    expect(FormSchema.safeParse(two).success).toBe(false);
    const mismatched = { ...base, fields: [{ key: "mail", type: "text", label: "Mail", required: true, role: "email" }] };
    expect(FormSchema.safeParse(mismatched).success).toBe(false);
  });

  it("needs options on a dropdown and drops options from other fields", () => {
    expect(FormSchema.safeParse({ ...base, fields: [{ key: "topic", type: "select", label: "Topic", required: true }] }).success).toBe(false);
    expect(FormSchema.safeParse({ ...base, fields: [{ key: "topic", type: "select", label: "Topic", required: true, options: ["A", "B"] }] }).success).toBe(true);
    const parsed = FormSchema.parse({ ...base, fields: [{ key: "t", type: "text", label: "T", required: false, options: ["leftover"] }] });
    expect(parsed.fields[0]).not.toHaveProperty("options", ["leftover"]);
    const tooMany = Array.from({ length: 31 }, (_, i) => `o${i}`);
    expect(FormSchema.safeParse({ ...base, fields: [{ key: "t", type: "select", label: "T", required: false, options: tooMany }] }).success).toBe(false);
  });

  it("takes plain staff mailboxes only: no display names, no line breaks, no more than five", () => {
    expect(FormSchema.safeParse({ ...base, notifyEmails: ["sales@example.com", "Boss@Example.com"] }).success).toBe(true);
    expect(FormSchema.parse({ ...base, notifyEmails: ["Boss@Example.com"] }).notifyEmails).toEqual(["boss@example.com"]);
    for (const bad of ["a@b.co\r\nBcc: x@y.z", "Name <a@b.co>", "a@b.co, c@d.co", "not-an-email", '"a"@b.co']) {
      expect(FormSchema.safeParse({ ...base, notifyEmails: [bad] }).success, bad).toBe(false);
    }
    expect(FormSchema.safeParse({ ...base, notifyEmails: Array.from({ length: 6 }, (_, i) => `a${i}@example.com`) }).success).toBe(false);
    expect(FormSchema.safeParse({ ...base, notifyEmails: ["a@example.com", "A@example.com"] }).success).toBe(false);
  });

  it("restricts the slug", () => {
    expect(FormSchema.parse({ ...base, slug: "Product-Enquiry" }).slug).toBe("product-enquiry");
    for (const slug of ["has space", "-lead", "a/b", "x".repeat(61), ""]) expect(FormSchema.safeParse({ ...base, slug }).success, slug).toBe(false);
  });
});

describe("UpdateFormSchema", () => {
  it("is partial, and the slug cannot be changed", () => {
    expect(UpdateFormSchema.safeParse({ name: "New name" }).success).toBe(true);
    expect(UpdateFormSchema.safeParse({}).success).toBe(true);
    expect(UpdateFormSchema.parse({ name: "x", slug: "other" })).not.toHaveProperty("slug");
  });

  it("still validates the fields it is given", () => {
    expect(UpdateFormSchema.safeParse({ fields: [] }).success).toBe(false);
  });

  it("does not reset what the request leaves out", () => {
    const parsed = UpdateFormSchema.parse({ name: "x" });
    expect(parsed).not.toHaveProperty("isActive");
    expect(parsed).not.toHaveProperty("acknowledge");
  });
});

describe("lead schemas", () => {
  it("lists with sane paging limits", () => {
    expect(ListLeadsSchema.parse({})).toMatchObject({ page: 1, pageSize: 25 });
    expect(ListLeadsSchema.safeParse({ pageSize: 51 }).success).toBe(false);
    expect(ListLeadsSchema.safeParse({ status: "pending" }).success).toBe(false);
    expect(ListLeadsSchema.parse({ status: "new", form: "contact", q: "chrome", page: "2" }).page).toBe(2);
  });

  it("updates status and/or notes, but not nothing", () => {
    expect(UpdateLeadSchema.safeParse({ status: "won" }).success).toBe(true);
    expect(UpdateLeadSchema.safeParse({ notes: "Called" }).success).toBe(true);
    expect(UpdateLeadSchema.safeParse({}).success).toBe(false);
    expect(UpdateLeadSchema.safeParse({ status: "meh" }).success).toBe(false);
    expect(UpdateLeadSchema.safeParse({ notes: "x".repeat(4001) }).success).toBe(false);
  });
});
