/**
 * The form builder and the leads inbox: how a site that does not sell online
 * still collects enquiries, quote requests and contact messages.
 */

const asConst = <const T extends readonly string[]>(values: T) => values;

export const FORM_FIELD_TYPES = asConst(["text", "email", "phone", "textarea", "select", "checkbox", "number", "date"]);
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/** A field with a role fills the lead's name/email/phone columns, so the inbox can show and search them. */
export const FORM_FIELD_ROLES = asConst(["name", "email", "phone"]);
export type FormFieldRole = (typeof FORM_FIELD_ROLES)[number];

/** Keys are stored in lead data; keep them boring. */
export const FORM_FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/;
export const FORM_SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;

export interface FormField {
  /** Stable key, unique within the form. */
  key: string;
  type: FormFieldType;
  label: string;
  placeholder?: string;
  helpText?: string;
  required: boolean;
  role?: FormFieldRole;
  /** `select` only. */
  options?: string[];
}

export const MAX_FORM_FIELDS = 20;
export const MAX_FORMS = 20;

/** Everything about a form, including who is told when it is submitted. */
export interface FormDef {
  slug: string;
  name: string;
  fields: FormField[];
  submitLabel: string;
  /** Shown after a successful submit. */
  successMessage: string;
  /** Staff mailboxes alerted on every submission. Never sent to browsers. */
  notifyEmails: string[];
  /** Email the submitter a copy when the form has an email field. */
  acknowledge: boolean;
  isActive: boolean;
}

/** What a browser may know about a form. */
export type PublicForm = Pick<FormDef, "slug" | "name" | "fields" | "submitLabel" | "successMessage">;

/** Where a submission came from, so staff know which product or page prompted it. */
export interface LeadSource {
  path?: string;
  productId?: string;
}

export interface FormSubmission {
  values: Record<string, string | number | boolean>;
  source?: LeadSource;
  /** Honeypot: a real form leaves it empty. */
  website?: string;
  /** Epoch ms when the form was rendered; an instant submit is a bot. */
  startedAt?: number;
}

export const LEAD_STATUSES = asConst(["new", "contacted", "qualified", "won", "lost", "spam"]);
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  won: "Won",
  lost: "Lost",
  spam: "Spam",
};

export interface LeadRow {
  id: string;
  formSlug: string;
  /** The form's name when the lead arrived; renaming the form does not rewrite history. */
  formName: string;
  status: LeadStatus;
  name: string | null;
  email: string | null;
  phone: string | null;
  /** Labels and answers as they were when submitted (rule 5). */
  answers: { label: string; value: string }[];
  source: { path: string | null; productName: string | null; productSku: string | null };
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeadPage {
  total: number;
  page: number;
  items: LeadRow[];
  /** Count per status for the inbox tabs. */
  counts: Record<LeadStatus, number>;
}

/** Enquiry / contact form the templates start from. */
export const CONTACT_FORM_SLUG = "contact";
