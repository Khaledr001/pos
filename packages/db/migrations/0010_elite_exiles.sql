ALTER TABLE "variant_units" ADD COLUMN "is_purchasable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD COLUMN "unit_id" uuid;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD COLUMN "unit_conversion_factor" numeric(12, 4) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;