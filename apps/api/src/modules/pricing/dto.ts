import { PRICE_LIST_TYPES, CURRENCIES } from "@devsfleet/shared-types";
import { Money } from "@devsfleet/shared-utils";
import { z } from "zod";
import { zMoney } from "../../common/validation/money.js";
import { zQueryBoolean } from "../../common/pipes/zod-validation.pipe.js";
import { BULK_PRICE_FIELDS, BULK_PRICE_ROUNDING } from "./bulk-price.js";

const DATE_STRING = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const CreatePriceListSchema = z.object({
  name: z.string().trim().min(1).max(255),
  type: z.enum(PRICE_LIST_TYPES),
  currency: z.enum(CURRENCIES).default("AED"),
  isDefault: z.boolean().default(false),
});
export type CreatePriceListDto = z.infer<typeof CreatePriceListSchema>;

export const UpdatePriceListSchema = CreatePriceListSchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdatePriceListDto = z.infer<typeof UpdatePriceListSchema>;

export const ListPriceListsSchema = z.object({
  includeInactive: zQueryBoolean(false),
});
export type ListPriceListsDto = z.infer<typeof ListPriceListsSchema>;

/**
 * One variant's price on one list. `effectiveFrom` defaults to today — the
 * common case is "this is the price from now on", not a scheduled future
 * change. Backdating (a date before the current row's own start) is refused
 * by the service: correcting history is what `reason` and price_history are
 * for, not silently rewriting when a price "started".
 */
export const SetProductPriceSchema = z.object({
  variantId: z.string().uuid(),
  priceListId: z.string().uuid(),
  sellingPrice: zMoney({ positive: "A selling price is required" }),
  purchasePrice: zMoney().optional(),
  minSellingPrice: zMoney().optional(),
  /**
   * Quantity break: 1 (the default) is the ordinary, untiered price. A
   * second row at e.g. 10 applies once the sold quantity reaches 10 —
   * each threshold has its own independent effective-dating timeline.
   */
  minQuantity: z.coerce.number().positive().default(1),
  effectiveFrom: DATE_STRING.optional(),
  /** Shown against the price_history row this write produces. */
  reason: z.string().trim().max(500).optional(),
});
export type SetProductPriceDto = z.infer<typeof SetProductPriceSchema>;

/**
 * Capped well above any realistic single request — this runs inside one
 * transaction, and an unbounded array is an unbounded lock duration.
 */
export const BulkSetProductPricesSchema = z.object({
  items: z.array(SetProductPriceSchema).min(1).max(1000),
});
export type BulkSetProductPricesDto = z.infer<typeof BulkSetProductPricesSchema>;

export const SetCustomerPriceSchema = z.object({
  customerId: z.string().uuid(),
  variantId: z.string().uuid(),
  specialPrice: zMoney({ positive: "A price is required" }),
  notes: z.string().trim().max(1000).optional(),
  effectiveFrom: DATE_STRING.optional(),
});
export type SetCustomerPriceDto = z.infer<typeof SetCustomerPriceSchema>;

export const ListPriceHistorySchema = z.object({
  variantId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListPriceHistoryDto = z.infer<typeof ListPriceHistorySchema>;

/**
 * Which rows a bulk re-price touches, and how they move. Shared by preview
 * and apply so the two can never be asked different questions.
 *
 * Only the base tier (minQuantity 1) is moved. A quantity break is a
 * negotiated step below the base price, and scaling it by the same percent
 * as the base would be a coincidence, not a rule.
 */
const BulkPriceBaseSchema = z
  .object({
    /** Defaults to the tenant's default price list. */
    priceListId: z.string().uuid().optional(),
    /** Includes every subcategory beneath it. */
    categoryId: z.string().uuid().optional(),
    brandId: z.string().uuid().optional(),
    supplierId: z.string().uuid().optional(),
    /** Product name or SKU. */
    q: z.string().trim().max(100).optional(),

    field: z.enum(BULK_PRICE_FIELDS).default("sellingPrice"),
    mode: z.enum(["percent", "amount"]),
    direction: z.enum(["increase", "decrease"]),
    value: zMoney({ positive: "Enter how much to change the price by" }),
    rounding: z.enum(BULK_PRICE_ROUNDING).default("none"),
    /** Write lines that would end up under their floor. Needs price:override_floor. */
    allowBelowFloor: z.boolean().default(false),
  })
  .refine(
    (v) =>
      !(v.mode === "percent" && v.direction === "decrease" && Money.toMinor(v.value) >= Money.toMinor("100")),
    { message: "A decrease of 100% or more would leave no price", path: ["value"] },
  );

export const BulkPricePreviewSchema = BulkPriceBaseSchema.and(
  z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    /** Which lines the page shows. Counts always cover the whole set. */
    show: z.enum(["all", "changing", "skipped"]).default("all"),
  }),
);
export type BulkPricePreviewDto = z.infer<typeof BulkPricePreviewSchema>;

export const BulkPriceApplySchema = BulkPriceBaseSchema.and(
  z.object({
    /** Required, and kept on every price_history row this writes. */
    reason: z.string().trim().min(3, "Say why these prices are changing").max(500),
    /** From the preview the user confirmed. */
    expectedCount: z.number().int().min(1),
    fingerprint: z.string().min(1),
  }),
);
export type BulkPriceApplyDto = z.infer<typeof BulkPriceApplySchema>;
