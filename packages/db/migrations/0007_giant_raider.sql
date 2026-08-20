CREATE TABLE "product_supplier_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"supplier_sku" varchar(100),
	"supplier_barcode" varchar(64),
	"lead_time_days" integer,
	"last_cost" numeric(12, 4),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_supplier_links" ADD CONSTRAINT "product_supplier_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_supplier_links" ADD CONSTRAINT "product_supplier_links_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_supplier_links" ADD CONSTRAINT "product_supplier_links_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_product_supplier_links_supplier_variant" ON "product_supplier_links" USING btree ("supplier_id","variant_id");--> statement-breakpoint
CREATE INDEX "idx_product_supplier_links_barcode" ON "product_supplier_links" USING btree ("supplier_id","supplier_barcode") WHERE supplier_barcode IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_product_supplier_links_sku" ON "product_supplier_links" USING btree ("supplier_id","supplier_sku") WHERE supplier_sku IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_product_supplier_links_variant" ON "product_supplier_links" USING btree ("variant_id");