ALTER TABLE "variant_units" ADD CONSTRAINT "ck_variant_units_factor_positive" CHECK (conversion_factor > 0);--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "ck_grn_items_factor_positive" CHECK (unit_conversion_factor > 0);--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "ck_po_items_factor_positive" CHECK (unit_conversion_factor > 0);