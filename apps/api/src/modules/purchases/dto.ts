import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, PURCHASE_ORDER_STATUSES } from "@devsfleet/shared-types";
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");

/**
 * Quantities are stored at 4 decimals, so anything finer is silently truncated
 * on the way in. Refusing it is better than a receipt that never closes its
 * order because 0.00005 of a unit went missing.
 */
const quantity4dp = <T extends z.ZodType<number, unknown>>(schema: T) =>
  schema.refine((v) => Math.abs(v * 10_000 - Math.round(v * 10_000)) < 1e-6, {
    message: "At most 4 decimal places",
  });

const PurchaseLineSchema = z.object({
  variantId: z.string().uuid(),
  /**
   * In the ORDERED unit — two boxes is `2`. Never base units: the conversion
   * happens server-side so the PO a supplier receives still says "2 boxes".
   */
  quantity: quantity4dp(z.coerce.number().positive()),
  /** A packaging from that variant's `variant_units`. Omit to order the base unit. */
  unitId: z.string().uuid().optional(),
  /** What the supplier charges FOR ONE OF `unitId` — per box, not per piece. */
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

const ReceiptLineSchema = z
  .object({
    /** Omit on a direct receipt with no order behind it. */
    purchaseOrderItemId: z.string().uuid().optional(),
    /**
     * Omit to resolve the variant from `supplierSku`/`supplierBarcode`
     * instead (Stage 5.4) — the point of a direct receipt (no PO already
     * naming a variant): a supplier's own delivery note becomes usable
     * as-is, matched against product_supplier_links for THIS receipt's
     * supplier, rather than requiring every UUID already known by heart.
     */
    variantId: z.string().uuid().optional(),
    /** The supplier's own SKU for this item — checked when variantId is omitted. */
    supplierSku: z.string().trim().min(1).max(100).optional(),
    /** The supplier's own barcode for this item — checked when variantId is omitted. */
    supplierBarcode: z.string().trim().min(1).max(64).optional(),
    /**
     * In the RECEIVED unit — one box is `1`. May differ from the unit the
     * order was raised in: order two boxes, take delivery of one box today
     * and 300 loose pieces on Thursday.
     */
    quantity: quantity4dp(z.coerce.number().positive()),
    /** A packaging from that variant's `variant_units`. Omit to receive base units. */
    unitId: z.string().uuid().optional(),
    /**
     * Required, one per SELLABLE BASE unit, when the product tracks serial
     * numbers. The count must equal the base-unit quantity minus damaged
     * exactly — a serialised product with no identity for one of its units is
     * not something a warranty claim can ever be answered for.
     *
     * Capped: receiving two boxes of a thousand serialised items is a 2,000
     * element payload, and anything larger is a mistake rather than a delivery.
     */
    serials: z.array(z.string().trim().min(1)).max(5000).optional(),
    /**
     * Required on a direct receipt; on a PO receipt it defaults to the ordered
     * price, rescaled if the units differ. Supplied when the invoice differs
     * from the quote, which is common. Per RECEIVED unit — per box, not per
     * piece.
     */
    unitPrice: z.coerce.number().min(0).optional(),
    /**
     * Arrived broken, in BASE UNITS — not in the received unit like `quantity`.
     *
     * One broken screw out of a box of a thousand is `1`. In boxes it would be
     * 0.001, and the obvious input — typing `1` — would write off the lot.
     */
    damagedQuantity: quantity4dp(z.coerce.number().min(0)).default(0),
    batchNumber: z.string().trim().max(50).optional(),
    expiryDate: isoDate.optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.variantId || v.supplierSku || v.supplierBarcode, {
    message: "Name the variant directly, or give a supplierSku/supplierBarcode to resolve one",
    path: ["variantId"],
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

/** For the receiving screen: "what does this scanned code resolve to?" before a whole receipt is submitted. */
export const SupplierLookupSchema = z.object({
  supplierId: z.string().uuid(),
  code: z.string().trim().min(1).max(100),
});
export type SupplierLookupDto = z.infer<typeof SupplierLookupSchema>;

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
