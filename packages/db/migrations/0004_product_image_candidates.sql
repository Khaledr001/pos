CREATE TABLE "product_image_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"image_url" varchar(2000) NOT NULL,
	"thumbnail_url" varchar(2000),
	"source_page_url" varchar(2000) NOT NULL,
	"source_domain" varchar(255) NOT NULL,
	"title" varchar(500),
	"width" integer,
	"height" integer,
	"match_score" integer DEFAULT 0 NOT NULL,
	"query" varchar(500),
	"status" varchar(10) DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ck_image_candidates_score" CHECK (match_score BETWEEN 0 AND 100)
);
--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "source" varchar(255);--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "source_url" varchar(1000);--> statement-breakpoint
ALTER TABLE "product_image_candidates" ADD CONSTRAINT "product_image_candidates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_image_candidates" ADD CONSTRAINT "product_image_candidates_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_image_candidates_product_url" ON "product_image_candidates" USING btree ("tenant_id","product_id","image_url");--> statement-breakpoint
CREATE INDEX "idx_image_candidates_product_status" ON "product_image_candidates" USING btree ("product_id","status");