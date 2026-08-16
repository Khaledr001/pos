import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, PURCHASE_ORDER_STATUSES } from "@devsfleet/shared-types";
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");

const PurchaseLineSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  /** What the supplier charges. Not the selling price. */
  unitPrice: z.coerce.number().min(0),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
  taxPercent: z.coerce.number().min(0).max(100).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const CreatePurchaseOrderSchema = z.object({
  branchId: z.string().uuid().optional(),
  supplierId: z.string().uuid(),
  lines: z.array(PurchaseLineSchema).min(1, "A purchase order needs at least one line"),

  /**
   * Freight, customs and handling for the whole order. Spread across lines by
   * value when the goods are received, so each unit carries what it really cost
   * to get onto the shelf.
   */
  shippingAmount: z.coerce.number().min(0).default(0),
  expectedDate: isoDate.optional(),
  supplierReference: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type CreatePurchaseOrderDto = z.infer<typeof CreatePurchaseOrderSchema>;

export const UpdatePurchaseOrderSchema = CreatePurchaseOrderSchema.partial().omit({
  branchId: true,
  supplierId: true,
});
export type UpdatePurchaseOrderDto = z.infer<typeof UpdatePurchaseOrderSchema>;

const ReceiptLineSchema = z.object({
  /** Omit on a direct receipt with no order behind it. */
  purchaseOrderItemId: z.string().uuid().optional(),
  variantId: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  /**
   * Required on a direct receipt; on a PO receipt it defaults to the ordered
   * price. Supplied when the invoice differs from the quote, which is common.
   */
  unitPrice: z.coerce.number().min(0).optional(),
  /** Arrived broken. Recorded, but never added to sellable stock. */
  damagedQuantity: z.coerce.number().min(0).default(0),
  batchNumber: z.string().trim().max(50).optional(),
  expiryDate: isoDate.optional(),
  notes: z.string().trim().max(500).optional(),
});

export const ReceiveGoodsSchema = z.object({
  branchId: z.string().uuid().optional(),
  /** Omit for a direct receipt — a cash purchase with no prior order. */
  purchaseOrderId: z.string().uuid().optional(),
  /** Required when there is no purchase order to take it from. */
  supplierId: z.string().uuid().optional(),

  lines: z.array(ReceiptLineSchema).min(1, "A receipt needs at least one line"),

  /**
   * Freight on THIS delivery. Overrides the order's figure for these lines —
   * a split delivery is shipped twice, and charging the whole order's freight
   * to the first half overstates the cost of everything in it.
   */
  shippingAmount: z.coerce.number().min(0).optional(),

  supplierInvoiceNumber: z.string().trim().max(100).optional(),
  supplierInvoiceDate: isoDate.optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type ReceiveGoodsDto = z.infer<typeof ReceiveGoodsSchema>;

export const ListPurchaseOrdersSchema = z.object({
  branchId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ListPurchaseOrdersDto = z.infer<typeof ListPurchaseOrdersSchema>;
