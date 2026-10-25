import {
  FORM_FIELD_KEY,
  FORM_FIELD_ROLES,
  FORM_FIELD_TYPES,
  FORM_SLUG,
  LEAD_STATUSES,
  MAX_FORM_FIELDS,
  type FormFieldRole,
  type FormFieldType,
} from "@devsfleet/shared-types";
import { z } from "zod";
import { label, mailbox, text } from "./field-rules.js";

/** A role fills a lead's name/email/phone column, so the field's type has to be able to hold it. */
const ROLE_TYPE: Record<FormFieldRole, FormFieldType> = { name: "text", email: "email", phone: "phone" };

const FormFieldSchema = z
  .object({
    key: z.string().trim().regex(FORM_FIELD_KEY, "Lowercase letters, digits and _, starting with a letter"),
    type: z.enum(FORM_FIELD_TYPES),
    label: label(120),
    placeholder: text(120).optional(),
    helpText: text(240).optional(),
    required: z.boolean(),
    role: z.enum(FORM_FIELD_ROLES).optional(),
    options: z.array(label(80)).max(30).optional(),
  })
  .superRefine((field, ctx) => {
    if (field.type === "select" && (field.options ?? []).length === 0) {
      ctx.addIssue({ code: "custom", message: "A dropdown needs at least one option", path: ["options"] });
    }
    if (field.role && ROLE_TYPE[field.role] !== field.type) {
      ctx.addIssue({ code: "custom", message: `A field that gives the lead's ${field.role} must be a ${ROLE_TYPE[field.role]} field`, path: ["role"] });
    }
  })
  // Options belong to dropdowns only; storing them on a text field would be dead data.
  .transform((field) => (field.type === "select" ? field : { ...field, options: undefined }));

/** Checked on the array, not the object: a refined object cannot be `.partial()`-ed for the PATCH. */
const FormFieldsSchema = z
  .array(FormFieldSchema)
  .min(1, "A form needs at least one field")
  .max(MAX_FORM_FIELDS)
  .superRefine((fields, ctx) => {
    const keys = new Set<string>();
    const roles = new Set<string>();
    fields.forEach((f, i) => {
      if (keys.has(f.key)) ctx.addIssue({ code: "custom", message: `Two fields use the key "${f.key}"`, path: [i, "key"] });
      keys.add(f.key);
      if (f.role) {
        if (roles.has(f.role)) ctx.addIssue({ code: "custom", message: `Only one field can give the lead's ${f.role}`, path: [i, "role"] });
        roles.add(f.role);
      }
    });
  });

const notifyEmails = z
  .array(mailbox)
  .max(5)
  .refine((emails) => new Set(emails).size === emails.length, { message: "Each address once" });

/**
 * The editable fields, WITHOUT defaults. Zod 4 applies a default even through
 * `.partial()`, so a PATCH built from a schema that has them would silently
 * reset every field it did not mention (switch the form back on, wipe the
 * staff addresses). The create schema adds the defaults; the update schema
 * never has them.
 */
const formFields = {
  name: label(120),
  fields: FormFieldsSchema,
  submitLabel: label(60),
  successMessage: label(500),
  notifyEmails,
  acknowledge: z.boolean(),
  isActive: z.boolean(),
};

export const FormSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(FORM_SLUG, "Lowercase letters, digits and hyphens"),
  ...formFields,
  submitLabel: formFields.submitLabel.default("Send"),
  successMessage: formFields.successMessage.default("Thanks! We'll be in touch."),
  notifyEmails: formFields.notifyEmails.default([]),
  acknowledge: formFields.acknowledge.default(true),
  isActive: formFields.isActive.default(true),
});
export type FormDto = z.infer<typeof FormSchema>;

/** The address is the form's identity (pages and the enquiry button name it), so it is not editable. */
export const UpdateFormSchema = z.object(formFields).partial();
export type UpdateFormDto = z.infer<typeof UpdateFormSchema>;

// ── leads ────────────────────────────────────────────────────────────────

export const LeadFiltersSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  form: z.string().trim().max(60).optional(),
  q: z.string().trim().max(100).optional(),
});

export const ListLeadsSchema = LeadFiltersSchema.extend({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(25),
});
export type ListLeadsDto = z.infer<typeof ListLeadsSchema>;
export type LeadFiltersDto = z.infer<typeof LeadFiltersSchema>;

export const UpdateLeadSchema = z
  .object({ status: z.enum(LEAD_STATUSES), notes: z.string().max(4000) })
  .partial()
  .refine((v) => v.status !== undefined || v.notes !== undefined, { message: "Nothing to change" });
export type UpdateLeadDto = z.infer<typeof UpdateLeadSchema>;
