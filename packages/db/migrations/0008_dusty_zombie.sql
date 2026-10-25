CREATE TABLE "storefront_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" varchar(60) NOT NULL,
	"name" varchar(120) NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submit_label" varchar(60) DEFAULT 'Send' NOT NULL,
	"success_message" varchar(500) DEFAULT 'Thanks! We''ll be in touch.' NOT NULL,
	"notify_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"acknowledge" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storefront_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"form_id" uuid,
	"form_slug" varchar(60) NOT NULL,
	"form_name" varchar(120) NOT NULL,
	"status" varchar(10) DEFAULT 'new' NOT NULL,
	"name" varchar(255),
	"email" varchar(255),
	"phone" varchar(30),
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_path" varchar(300),
	"product_id" uuid,
	"product_name" varchar(255),
	"product_sku" varchar(100),
	"notes" text DEFAULT '' NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"ip_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "storefront_pages" ADD COLUMN "sections" jsonb;--> statement-breakpoint
ALTER TABLE "storefront_pages" ADD COLUMN "layout" varchar(10) DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "storefront_forms" ADD CONSTRAINT "storefront_forms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storefront_leads" ADD CONSTRAINT "storefront_leads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storefront_leads" ADD CONSTRAINT "storefront_leads_form_id_storefront_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."storefront_forms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storefront_leads" ADD CONSTRAINT "storefront_leads_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_storefront_forms_tenant_slug" ON "storefront_forms" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "idx_storefront_leads_inbox" ON "storefront_leads" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_storefront_leads_form" ON "storefront_leads" USING btree ("tenant_id","form_slug");--> statement-breakpoint
CREATE INDEX "idx_storefront_leads_dedupe" ON "storefront_leads" USING btree ("tenant_id","content_hash","created_at");