CREATE TABLE "customer_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"amount" numeric(12, 4) NOT NULL,
	"method" varchar(20) NOT NULL,
	"reference_number" varchar(80),
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"type" varchar(20) NOT NULL,
	"reference_type" varchar(40),
	"reference_id" uuid,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "formula_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"formula_id" uuid NOT NULL,
	"component_name" varchar(80) NOT NULL,
	"quantity_ml" numeric(12, 4) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paint_formulas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"color_code" varchar(40) NOT NULL,
	"color_name" varchar(120) NOT NULL,
	"base_variant_id" uuid NOT NULL,
	"size_ml" integer NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paint_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"formula_id" uuid,
	"sale_id" uuid,
	"custom_notes" text,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "loyalty_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formula_components" ADD CONSTRAINT "formula_components_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formula_components" ADD CONSTRAINT "formula_components_formula_id_paint_formulas_id_fk" FOREIGN KEY ("formula_id") REFERENCES "public"."paint_formulas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paint_formulas" ADD CONSTRAINT "paint_formulas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paint_formulas" ADD CONSTRAINT "paint_formulas_base_variant_id_product_variants_id_fk" FOREIGN KEY ("base_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paint_orders" ADD CONSTRAINT "paint_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paint_orders" ADD CONSTRAINT "paint_orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paint_orders" ADD CONSTRAINT "paint_orders_formula_id_paint_formulas_id_fk" FOREIGN KEY ("formula_id") REFERENCES "public"."paint_formulas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paint_orders" ADD CONSTRAINT "paint_orders_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paint_orders" ADD CONSTRAINT "paint_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_customer_payments_customer" ON "customer_payments" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_loyalty_customer" ON "loyalty_transactions" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_loyalty_reference" ON "loyalty_transactions" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "idx_formula_components_formula" ON "formula_components" USING btree ("formula_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_paint_formulas_code_size" ON "paint_formulas" USING btree ("tenant_id","color_code","size_ml");--> statement-breakpoint
CREATE INDEX "idx_paint_formulas_search" ON "paint_formulas" USING btree ("tenant_id","color_name");--> statement-breakpoint
CREATE INDEX "idx_paint_orders_branch" ON "paint_orders" USING btree ("branch_id","created_at");