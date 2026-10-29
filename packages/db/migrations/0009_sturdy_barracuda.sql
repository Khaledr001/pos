CREATE TABLE "einvoice_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" varchar(12) DEFAULT 'sandbox' NOT NULL,
	"endpoint_url" varchar(500),
	"credentials_enc" text,
	"callback_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_test_at" timestamp with time zone,
	"last_test_ok" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "einvoice_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"doc_type" varchar(12) NOT NULL,
	"document_number" varchar(40) NOT NULL,
	"uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"status" varchar(12) DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"snapshot" jsonb,
	"xml" text,
	"xml_sha256" varchar(64),
	"pint_version" varchar(12),
	"provider_ref" varchar(200),
	"mode" varchar(8) DEFAULT 'sandbox' NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "einvoice_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"status" varchar(12) NOT NULL,
	"message" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "tax_category" varchar(1) DEFAULT 'S' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "tax_exemption_code" varchar(12);--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "unit_code" varchar(3) DEFAULT 'C62' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "address_line1" varchar(200);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "address_line2" varchar(200);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "address_city" varchar(100);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "address_subdivision" varchar(20);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "address_postal_code" varchar(20);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "address_country" varchar(2) DEFAULT 'AE' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "einvoice_scheme" varchar(4);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "einvoice_endpoint" varchar(100);--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "tax_category" varchar(1) DEFAULT 'S' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "tax_exemption_code" varchar(12);--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "unit_code" varchar(3) DEFAULT 'C62' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD COLUMN "tax_category" varchar(1) DEFAULT 'S' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD COLUMN "tax_exemption_code" varchar(12);--> statement-breakpoint
ALTER TABLE "quotation_items" ADD COLUMN "unit_code" varchar(3) DEFAULT 'C62' NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "tax_category" varchar(1) DEFAULT 'S' NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "tax_exemption_code" varchar(12);--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "unit_code" varchar(3) DEFAULT 'C62' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "credit_reason" varchar(12);--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "credit_reason_note" text;--> statement-breakpoint
ALTER TABLE "einvoice_accounts" ADD CONSTRAINT "einvoice_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einvoice_documents" ADD CONSTRAINT "einvoice_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einvoice_documents" ADD CONSTRAINT "einvoice_documents_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einvoice_documents" ADD CONSTRAINT "einvoice_documents_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einvoice_events" ADD CONSTRAINT "einvoice_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einvoice_events" ADD CONSTRAINT "einvoice_events_document_id_einvoice_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."einvoice_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_einvoice_accounts_tenant" ON "einvoice_accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_einvoice_accounts_callback" ON "einvoice_accounts" USING btree ("callback_token");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_einvoice_documents_sale" ON "einvoice_documents" USING btree ("sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_einvoice_documents_uuid" ON "einvoice_documents" USING btree ("uuid");--> statement-breakpoint
CREATE INDEX "idx_einvoice_documents_sweep" ON "einvoice_documents" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "idx_einvoice_documents_register" ON "einvoice_documents" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_einvoice_events_document" ON "einvoice_events" USING btree ("document_id","created_at");--> statement-breakpoint
-- A rate of 0 with the default category S would be an invalid combination. Existing zero-rated lines were "zero-rated" in practice; a business that sells exempt goods re-categorises those products in the admin.
UPDATE "products" SET "tax_category" = 'Z' WHERE "tax_rate" IS NOT NULL AND "tax_rate" = 0;--> statement-breakpoint
UPDATE "sale_items" SET "tax_category" = 'Z' WHERE "tax_percent" = 0;--> statement-breakpoint
UPDATE "order_items" SET "tax_category" = 'Z' WHERE "tax_percent" = 0;--> statement-breakpoint
UPDATE "quotation_items" SET "tax_category" = 'Z' WHERE "tax_percent" = 0;
--> statement-breakpoint
-- Existing units default to C62 (each). Give the obvious ones their UN/ECE code, by what they are called; the owner can change any of them in the admin.
UPDATE "units" u SET "unit_code" = m.code
FROM (VALUES
  ('m','MTR'),('mtr','MTR'),('meter','MTR'),('metre','MTR'),
  ('kg','KGM'),('kgs','KGM'),('g','GRM'),('gm','GRM'),
  ('l','LTR'),('ltr','LTR'),('litre','LTR'),('liter','LTR'),('ml','MLT'),
  ('box','XBX'),('bx','XBX'),('pack','XPK'),('pk','XPK'),('roll','XRO'),('rol','XRO'),
  ('set','SET'),('pair','PR'),('pr','PR'),('sqm','MTK'),('m2','MTK'),('m3','MTQ'),
  ('hr','HUR'),('hour','HUR')
) AS m(abbr, code)
WHERE lower(trim(replace(u."abbreviation", '.', ''))) = m.abbr;
