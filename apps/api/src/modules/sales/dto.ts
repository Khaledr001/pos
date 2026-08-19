import { DEFAULT_PAGE_SIZE, DOCUMENT_SOURCES, MAX_PAGE_SIZE, PAYMENT_METHODS } from "@devsfleet/shared-types";
import { z } from "zod";

const SaleLineSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  /** Omit to take the resolved price. Present = an override, floor-checked. */
  unitPrice: z.string().optional(),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
  /**
   * Required, one per unit, when the product tracks serial numbers. Each is
   * claimed and marked sold at the branch this sale is rung up at — a serial
   * checked in at a different branch is refused, the same as selling stock a
   * branch does not physically hold.
   */
  serials: z.array(z.string().trim().min(1)).optional(),
});

const PaymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount: z.coerce.number().positive(),
  reference: z.string().trim().max(100).optional(),
});

export const CreateSaleSchema = z.object({
  branchId: z.string().uuid(),
  customerId: z.string().uuid().nullable().optional(),
  cashSessionId: z.string().uuid().nullable().optional(),
  source: z.enum(DOCUMENT_SOURCES).default("pos"),

  lines: z.array(SaleLineSchema).min(1, "A sale needs at least one line"),
  payments: z.array(PaymentSchema).default([]),
  documentDiscountPercent: z.coerce.number().min(0).max(100).optional(),
  notes: z.string().trim().max(1000).optional(),

  /**
   * Loyalty points the customer wants to spend against this sale, funding it
   * the same way a payment does. Capped server-side at the sale total — see
   * the service for why an overshoot is refused rather than partially honoured.
   */
  redeemPoints: z.coerce.number().int().positive().optional(),

  /**
   * Supervisor approvals collected at the till, as signed grants from
   * `POST /auth/verify-override`.
   *
   * They travel WITH the sale because that is the only way an approval given
   * at 09:40 survives to a push at 14:00 from a terminal that was offline in
   * between. Each one is verified here, not trusted: an unverifiable grant is
   * discarded and the cashier's own permissions decide, which is the same
   * answer as no approval at all.
   */
  overrideGrants: z.array(z.string().min(1)).max(20).optional(),

  /**
   * Minted on the terminal. The idempotency key — the server upserts on it, so
   * a push retried after a timeout cannot create a second invoice.
   */
  localId: z.string().uuid().optional(),
  /** The terminal's clock at the moment of sale. Hours before createdAt offline. */
  occurredAt: z.string().datetime().optional(),
});
export type CreateSaleDto = z.infer<typeof CreateSaleSchema>;

const RefundSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount: z.coerce.number().positive(),
  reference: z.string().trim().max(100).optional(),
});

const ReturnLineSchema = z.object({
  saleItemId: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  /**
   * "restock" puts the units back into sellable inventory; "scrap" records
   * that they came back damaged and writes them off with no stock movement
   * at all. There is no default — a cashier taking goods back must say which
   * one happened, not have the server guess.
   */
  disposition: z.enum(["restock", "scrap"]),
});

export const CreateReturnSchema = z.object({
  originalSaleId: z.string().uuid(),
  lines: z.array(ReturnLineSchema).min(1, "A return needs at least one line"),
  /**
   * How the refund is being paid out. Deliberately independent of how the
   * original sale was funded — a customer who paid by card is often refunded
   * in cash at the counter, and the reverse happens too.
   *
   * Optional and defaults to empty: a return against a sale that was on
   * account can be fully absorbed as a reduction to the customer's credit
   * balance, with no cash or card movement at all.
   */
  refunds: z.array(RefundSchema).default([]),
  reason: z.string().trim().max(500).optional(),
  cashSessionId: z.string().uuid().nullable().optional(),
  localId: z.string().uuid().optional(),
  occurredAt: z.string().datetime().optional(),
});
export type CreateReturnDto = z.infer<typeof CreateReturnSchema>;

export const VoidSaleSchema = z.object({
  reason: z.string().trim().min(1, "A void needs a reason").max(500),
});
export type VoidSaleDto = z.infer<typeof VoidSaleSchema>;

export const ListSalesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  branchId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});
export type ListSalesDto = z.infer<typeof ListSalesSchema>;
