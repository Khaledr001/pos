import { z } from 'zod';

/**
 * POS → website event payloads. Keep in step with docs/pos-integration.yaml.
 * Every change the POS sends carries a `version` that only goes up; the
 * website ignores anything not newer than what it already has.
 */

export const envelopeSchema = z.object({
  eventId: z.string().min(1).max(200),
  type: z.string().min(1).max(100),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  data: z.unknown(),
});
export type PosEnvelope = z.infer<typeof envelopeSchema>;

const uom = z.string().min(1).max(20);
const version = z.number().int().nonnegative();

export const productUpsertSchema = z.object({
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(300),
  barcode: z.string().max(64).nullish(),
  /** Groups SKUs into one product page, e.g. all sizes of a PPR pipe. */
  groupCode: z.string().max(64).nullish(),
  groupName: z.string().max(300).nullish(),
  baseUom: uom,
  weightGrams: z.number().int().nonnegative().default(0),
  vatClass: z.enum(['STANDARD_5', 'ZERO', 'EXEMPT']).default('STANDARD_5'),
  active: z.boolean(),
  options: z.record(z.string(), z.string()).nullish(),
  uomConversions: z.array(z.object({ uom, factor: z.number().positive() })).default([]),
  version,
});
export type ProductUpsert = z.infer<typeof productUpsertSchema>;

export const stockItemSchema = z.object({
  sku: z.string().min(1),
  branchCode: z.string().min(1),
  quantity: z.number(),
  version,
});
export type StockItem = z.infer<typeof stockItemSchema>;

export const stockUpdatedSchema = z.union([
  z.object({ items: z.array(stockItemSchema).min(1).max(5000) }),
  stockItemSchema.transform((item) => ({ items: [item] })),
]);

export const priceListUpsertSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  type: z.enum(['RETAIL', 'TRADE', 'PROMO']),
  channel: z.enum(['ALL', 'POS', 'ONLINE']).default('ALL'),
  priority: z.number().int().default(0),
  validFrom: z.string().datetime({ offset: true }).nullish(),
  validTo: z.string().datetime({ offset: true }).nullish(),
  active: z.boolean().default(true),
  version,
});
export type PriceListUpsert = z.infer<typeof priceListUpsertSchema>;

const priceKey = z.object({
  sku: z.string().min(1),
  uom,
  minQty: z.number().positive().default(1),
});

export const priceRowSchema = priceKey.extend({
  netPriceFils: z.number().int().nonnegative(),
});
export type PriceRow = z.infer<typeof priceRowSchema>;

export const priceItemsChangedSchema = z.object({
  priceListCode: z.string().min(1),
  version,
  upsert: z.array(priceRowSchema).default([]),
  delete: z.array(priceKey).default([]),
});

export const customerPriceListSchema = z
  .object({
    customerEmail: z.string().email().nullish(),
    posCustomerCode: z.string().nullish(),
    priceListCodes: z.array(z.string()).max(20),
  })
  .refine((v) => v.customerEmail || v.posCustomerCode, {
    message: 'customerEmail or posCustomerCode is required',
  });

export const orderStatusChangedSchema = z.object({
  orderNumber: z.string().min(1),
  status: z.enum(['CONFIRMED', 'PACKED', 'SHIPPED', 'READY_FOR_PICKUP', 'DELIVERED', 'COLLECTED', 'CANCELLED']),
  note: z.string().max(500).nullish(),
  trackingNumber: z.string().max(100).nullish(),
  trackingUrl: z.string().url().nullish(),
});

/** Full snapshot the POS serves at GET {POS_BASE_URL}/website/snapshot. */
export const snapshotSchema = z.object({
  products: z.array(productUpsertSchema),
  stock: z.array(stockItemSchema),
  priceLists: z.array(priceListUpsertSchema.extend({ items: z.array(priceRowSchema) })),
});
export type PosSnapshot = z.infer<typeof snapshotSchema>;

export const POS_EVENT_TYPES = [
  'product.upsert',
  'stock.updated',
  'price_list.upserted',
  'price_items.changed',
  'customer_price_list.assigned',
  'order.status_changed',
] as const;
