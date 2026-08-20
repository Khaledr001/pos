DROP INDEX "uq_product_prices_effective";--> statement-breakpoint
DROP INDEX "idx_product_prices_current";--> statement-breakpoint
ALTER TABLE "price_history" ADD COLUMN "min_quantity" numeric(12, 4) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_prices" ADD COLUMN "min_quantity" numeric(12, 4) DEFAULT '1' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_product_prices_effective" ON "product_prices" USING btree ("variant_id","price_list_id","min_quantity","effective_from");--> statement-breakpoint
CREATE INDEX "idx_product_prices_current" ON "product_prices" USING btree ("variant_id","price_list_id","min_quantity") WHERE effective_to IS NULL;