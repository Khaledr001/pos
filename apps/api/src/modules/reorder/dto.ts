import { z } from "zod";
import { zMoney } from "../../common/validation/money.js";

export const ReorderSuggestionsSchema = z.object({
  /** Required: what is low is a question about one shelf, not the whole business. */
  branchId: z.string().uuid(),
});
export type ReorderSuggestionsDto = z.infer<typeof ReorderSuggestionsSchema>;

const DraftLineSchema = z.object({
  variantId: z.string().uuid(),
  /** In the variant's BASE unit — what the suggestion was worked out in. */
  quantity: z.coerce
    .number()
    .positive()
    .refine((v) => Math.abs(v * 10_000 - Math.round(v * 10_000)) < 1e-6, "At most 4 decimal places"),
  /** Per base unit. The draft is a starting point; the supplier's invoice decides. */
  unitPrice: zMoney(),
});

const DraftOrderSchema = z
  .object({
    /**
     * Minted by the page once per supplier group and resent on every retry,
     * so a double-click or a timed-out request returns the order already
     * created instead of raising a second one.
     */
    clientId: z.string().uuid(),
    supplierId: z.string().uuid(),
    lines: z.array(DraftLineSchema).min(1).max(500),
  })
  .refine((o) => new Set(o.lines.map((l) => l.variantId)).size === o.lines.length, {
    message: "An item appears twice in one order — combine the quantities",
    path: ["lines"],
  });

export const CreateDraftOrdersSchema = z
  .object({
    branchId: z.string().uuid(),
    orders: z.array(DraftOrderSchema).min(1).max(50),
  })
  .refine((d) => new Set(d.orders.map((o) => o.supplierId)).size === d.orders.length, {
    message: "One order per supplier",
    path: ["orders"],
  });
export type CreateDraftOrdersDto = z.infer<typeof CreateDraftOrdersSchema>;
