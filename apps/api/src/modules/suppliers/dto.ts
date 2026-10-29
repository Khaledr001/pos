import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@devsfleet/shared-types";
import { z } from "zod";
import { sortSchema } from "../../common/db/list-query.js";
import { zQueryBoolean } from "../../common/pipes/zod-validation.pipe.js";

/**
 * A supplier with no defaults; Create adds the ones a NEW supplier starts from.
 * Update is the plain shape made partial — Zod 4 applies a `.default()` even
 * through `.partial()`, so an update derived from the create schema reset
 * every supplier's payment terms to 0 whenever anyone edited a phone number.
 */
const SupplierFields = z.object({
  name: z.string().trim().min(2, "Give the supplier a name").max(255),
  company: z.string().trim().max(255).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().toLowerCase().email().max(255).optional(),
  /** Tax Registration Number, checked against the business's region in the service. Blank clears it. */
  trn: z.string().trim().max(24).optional(),
  address: z.string().trim().max(1000).optional(),
  /** Days from invoice to payment due. 0 = cash on delivery. */
  paymentTermDays: z.coerce.number().int().min(0).max(365),
  contactPerson: z.string().trim().max(255).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const CreateSupplierSchema = SupplierFields.extend({
  paymentTermDays: z.coerce.number().int().min(0).max(365).default(0),
});
export type CreateSupplierDto = z.infer<typeof CreateSupplierSchema>;

export const UpdateSupplierSchema = SupplierFields.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateSupplierDto = z.infer<typeof UpdateSupplierSchema>;

export const ListSuppliersSchema = z.object({
  q: z.string().trim().max(100).optional(),
  includeInactive: zQueryBoolean(false),
  ...sortSchema(["createdAt", "name"], { sortBy: "createdAt", sortOrder: "desc" }),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ListSuppliersDto = z.infer<typeof ListSuppliersSchema>;
