import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@devsfleet/shared-types";
import { z } from "zod";

export const CreateSupplierSchema = z.object({
  name: z.string().trim().min(2, "Give the supplier a name").max(255),
  company: z.string().trim().max(255).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().toLowerCase().email().max(255).optional(),
  /** UAE Tax Registration Number. 15 digits, and only meaningful if exact. */
  trn: z.string().trim().max(20).optional(),
  address: z.string().trim().max(1000).optional(),
  /** Days from invoice to payment due. 0 = cash on delivery. */
  paymentTermDays: z.coerce.number().int().min(0).max(365).default(0),
  contactPerson: z.string().trim().max(255).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type CreateSupplierDto = z.infer<typeof CreateSupplierSchema>;

export const UpdateSupplierSchema = CreateSupplierSchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateSupplierDto = z.infer<typeof UpdateSupplierSchema>;

export const ListSuppliersSchema = z.object({
  q: z.string().trim().max(100).optional(),
  includeInactive: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ListSuppliersDto = z.infer<typeof ListSuppliersSchema>;
