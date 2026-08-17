import { CUSTOMER_TYPES, DEFAULT_PAGE_SIZE, LOCALES, MAX_PAGE_SIZE, PAYMENT_METHODS } from "@devsfleet/shared-types";
import { z } from "zod";

export const CreateCustomerSchema = z.object({
  branchId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1, "Give the customer a name").max(255),
  company: z.string().trim().max(255).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().toLowerCase().email().max(255).optional(),
  trn: z.string().trim().max(20).optional(),
  address: z.string().trim().max(1000).optional(),
  type: z.enum(CUSTOMER_TYPES).default("retail"),
  locale: z.enum(LOCALES).default("en"),
  priceListId: z.string().uuid().nullable().optional(),
  creditLimit: z.coerce.number().min(0).default(0),
  paymentTermDays: z.coerce.number().int().min(0).max(365).default(0),
  /** E.164. What the WhatsApp bot matches an inbound message against. */
  whatsappPhone: z.string().trim().max(20).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type CreateCustomerDto = z.infer<typeof CreateCustomerSchema>;

export const UpdateCustomerSchema = CreateCustomerSchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateCustomerDto = z.infer<typeof UpdateCustomerSchema>;

export const ListCustomersSchema = z.object({
  q: z.string().trim().max(100).optional(),
  type: z.enum(CUSTOMER_TYPES).optional(),
  /** Everyone currently over their credit limit — the collections view. */
  overLimitOnly: z.coerce.boolean().default(false),
  includeInactive: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ListCustomersDto = z.infer<typeof ListCustomersSchema>;

/**
 * `customer:credit` only — separated from the general update so a role that
 * may edit a phone number cannot also raise its own credit ceiling.
 */
export const SetCreditSchema = z.object({
  creditLimit: z.coerce.number().min(0),
  creditOnHold: z.boolean().optional(),
});
export type SetCreditDto = z.infer<typeof SetCreditSchema>;

export const RecordPaymentSchema = z.object({
  amount: z.coerce.number().positive(),
  method: z.enum(PAYMENT_METHODS),
  referenceNumber: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type RecordPaymentDto = z.infer<typeof RecordPaymentSchema>;

export const AdjustLoyaltySchema = z.object({
  /** Signed: positive to grant, negative to redeem or claw back. */
  points: z.coerce.number().int().refine((v) => v !== 0, "Zero points is not an adjustment"),
  reason: z.string().trim().min(3, "Explain the adjustment").max(500),
});
export type AdjustLoyaltyDto = z.infer<typeof AdjustLoyaltySchema>;
