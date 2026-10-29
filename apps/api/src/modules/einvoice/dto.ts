import { EINVOICE_MODES, EINVOICE_PROVIDERS, EINVOICE_STATUSES, EINVOICE_DOC_TYPES } from "@devsfleet/shared-types";
import { z } from "zod";
import { LEGAL_REGISTRATION_TYPES } from "./pint-ae/constants.js";

const noControl = (v: string) => !/[\r\n\u0000-\u001f]/.test(v);
const text = (max: number) => z.string().trim().min(1).max(max).refine(noControl, "Must be a single line");

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "That is not a real date");

/** PUT /einvoice/settings. Every field optional: it names only what changes. */
export const UpdateEinvoiceSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(EINVOICE_MODES).optional(),
  startDate: isoDate.nullable().optional(),
  autoSubmit: z.boolean().optional(),
  endpoint: z.object({ scheme: z.string().regex(/^\d{4}$/, "A four-digit scheme code such as 0235"), id: text(100) }).nullable().optional(),
  legalRegistration: z
    .object({ id: text(100), type: z.enum(LEGAL_REGISTRATION_TYPES), authority: text(100) })
    .nullable()
    .optional(),
});
export type UpdateEinvoiceSettingsDto = z.infer<typeof UpdateEinvoiceSettingsSchema>;

/** PUT /einvoice/provider. `credentials` is write-only; omitted = keep what is stored. */
export const UpdateProviderSchema = z.object({
  provider: z.enum(EINVOICE_PROVIDERS),
  endpointUrl: z.string().trim().url().max(500).nullable().optional(),
  credentials: z.string().min(8, "Credentials look too short").max(2000).refine(noControl, "Must be a single line").optional(),
});
export type UpdateProviderDto = z.infer<typeof UpdateProviderSchema>;

export const ListDocumentsSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(25),
  status: z.enum(EINVOICE_STATUSES).optional(),
  type: z.enum(EINVOICE_DOC_TYPES).optional(),
  q: z.string().trim().max(100).optional(),
});
export type ListDocumentsDto = z.infer<typeof ListDocumentsSchema>;

/** What a provider posts to the callback endpoint. */
export const CallbackBodySchema = z.object({
  id: z.union([z.string().trim().min(1).max(200), z.number()]).transform(String),
  status: z.enum(["accepted", "delivered", "rejected"]),
  errors: z
    .array(z.object({ code: z.union([z.string(), z.number()]).optional(), message: z.string().max(1000).optional() }))
    .max(50)
    .optional(),
});
