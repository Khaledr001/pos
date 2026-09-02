import { CUSTOMER_TYPES, DEFAULT_PAGE_SIZE, LOCALES, MAX_PAGE_SIZE, PAYMENT_METHODS } from "@devsfleet/shared-types";
import { normalizePhone } from "@devsfleet/shared-utils";
import { z } from "zod";
import { zQueryBoolean } from "../../common/pipes/zod-validation.pipe.js";

/**
 * A phone number, stored E.164.
 *
 * Normalised HERE, at the validation boundary, rather than in the service —
 * because the service is not the only door. An offline terminal's customer
 * push re-parses this same schema (`sync.service.ts` → `CreateCustomerSchema`
 * → `CustomersService.create`), so normalising at the boundary is what makes
 * every write path agree.
 *
 * It has to agree. `whatsappPhone` is the key the WhatsApp bot matches an
 * inbound sender against, under a unique index — and until this existed,
 * `+971501234567`, `971501234567` and `0501234567` were three distinct stored
 * values that all satisfied it. The bot would have failed to recognise most
 * existing customers, and the failure looks exactly like "this person is not
 * a customer".
 *
 * Input with no digits at all ("walk-in", "N/A") is treated as absent rather
 * than rejected. Nothing is lost — a phone field with no digits carries no
 * phone number — and rejecting it would wedge the outbox of a terminal that
 * has been taking that shortcut in the field for months.
 */
const phoneField = z
  .string()
  .trim()
  .max(20)
  .transform((value) => normalizePhone(value) ?? undefined);

export const CreateCustomerSchema = z.object({
  branchId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1, "Give the customer a name").max(255),
  company: z.string().trim().max(255).optional(),
  phone: phoneField.optional(),
  email: z.string().trim().toLowerCase().email().max(255).optional(),
  trn: z.string().trim().max(20).optional(),
  address: z.string().trim().max(1000).optional(),
  type: z.enum(CUSTOMER_TYPES).default("retail"),
  locale: z.enum(LOCALES).default("en"),
  priceListId: z.string().uuid().nullable().optional(),
  creditLimit: z.coerce.number().min(0).default(0),
  paymentTermDays: z.coerce.number().int().min(0).max(365).default(0),
  /** E.164. What the WhatsApp bot matches an inbound message against. */
  whatsappPhone: phoneField.optional(),
  notes: z.string().trim().max(1000).optional(),
  /** Minted on the terminal when created offline. */
  localId: z.string().uuid().optional(),
  /** The terminal's clock at the moment of creation. */
  occurredAt: z.string().datetime().optional(),
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
  overLimitOnly: zQueryBoolean(false),
  includeInactive: zQueryBoolean(false),
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
  branchId: z.string().uuid().optional(),
  amount: z.coerce.number().positive(),
  method: z.enum(PAYMENT_METHODS),
  /**
   * Which drawer the cash landed in. Not required — a manager settling an
   * invoice from the office with no till open has nowhere to attribute it —
   * but a `method: "cash"` payment given one is folded into that session's
   * cash movements, so the drawer isn't short at close for a reason nobody
   * can see.
   */
  cashSessionId: z.string().uuid().optional(),
  referenceNumber: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(1000).optional(),
  /** Minted on the terminal when recorded offline. */
  localId: z.string().uuid().optional(),
  /** The terminal's clock at the moment of collection. */
  occurredAt: z.string().datetime().optional(),
});
export type RecordPaymentDto = z.infer<typeof RecordPaymentSchema>;

export const AdjustLoyaltySchema = z.object({
  /** Signed: positive to grant, negative to redeem or claw back. */
  points: z.coerce.number().int().refine((v) => v !== 0, "Zero points is not an adjustment"),
  reason: z.string().trim().min(3, "Explain the adjustment").max(500),
});
export type AdjustLoyaltyDto = z.infer<typeof AdjustLoyaltySchema>;
