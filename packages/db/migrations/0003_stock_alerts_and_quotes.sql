CREATE TABLE "stock_alert_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(20),
	"account_id" uuid,
	"status" varchar(10) DEFAULT 'pending' NOT NULL,
	"notified_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"unsubscribe_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ck_stock_alerts_email_lowercase" CHECK (email = lower(email))
);
--> statement-breakpoint
CREATE TABLE "web_quote_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"product_name" varchar(255) NOT NULL,
	"variant_name" varchar(255),
	"product_sku" varchar(100) NOT NULL,
	"uom" varchar(20) NOT NULL,
	"tax_percent" numeric(5, 2) NOT NULL,
	"quantity" numeric(12, 4) NOT NULL,
	"unit_price" numeric(12, 4) NOT NULL,
	"quoted_unit_price" numeric(12, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ck_web_quote_items_quantity_positive" CHECK (quantity > 0)
);
--> statement-breakpoint
CREATE TABLE "web_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" varchar(30) NOT NULL,
	"account_id" uuid,
	"client_id" uuid NOT NULL,
	"status" varchar(10) DEFAULT 'requested' NOT NULL,
	"contact_name" varchar(255) NOT NULL,
	"contact_email" varchar(255) NOT NULL,
	"contact_phone" varchar(20) NOT NULL,
	"company_name" varchar(255),
	"notes" text,
	"staff_notes" text,
	"currency" varchar(3) NOT NULL,
	"tax_mode" varchar(10) NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"subtotal" numeric(12, 4) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(12, 4) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(12, 4) DEFAULT '0' NOT NULL,
	"total" numeric(12, 4) DEFAULT '0' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"quoted_at" timestamp with time zone,
	"quoted_by" uuid,
	"valid_until" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"converted_order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_alert_subscriptions" ADD CONSTRAINT "stock_alert_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_alert_subscriptions" ADD CONSTRAINT "stock_alert_subscriptions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_alert_subscriptions" ADD CONSTRAINT "stock_alert_subscriptions_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_alert_subscriptions" ADD CONSTRAINT "stock_alert_subscriptions_account_id_shopper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."shopper_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_quote_items" ADD CONSTRAINT "web_quote_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_quote_items" ADD CONSTRAINT "web_quote_items_quote_id_web_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."web_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_quote_items" ADD CONSTRAINT "web_quote_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_quote_items" ADD CONSTRAINT "web_quote_items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_quotes" ADD CONSTRAINT "web_quotes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_quotes" ADD CONSTRAINT "web_quotes_account_id_shopper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."shopper_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_quotes" ADD CONSTRAINT "web_quotes_quoted_by_users_id_fk" FOREIGN KEY ("quoted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_quotes" ADD CONSTRAINT "web_quotes_converted_order_id_orders_id_fk" FOREIGN KEY ("converted_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_stock_alerts_variant_email" ON "stock_alert_subscriptions" USING btree ("tenant_id","variant_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_stock_alerts_token" ON "stock_alert_subscriptions" USING btree ("unsubscribe_token");--> statement-breakpoint
CREATE INDEX "idx_stock_alerts_pending" ON "stock_alert_subscriptions" USING btree ("tenant_id","status","product_id");--> statement-breakpoint
CREATE INDEX "idx_web_quote_items_quote" ON "web_quote_items" USING btree ("quote_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_web_quotes_tenant_number" ON "web_quotes" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_web_quotes_client" ON "web_quotes" USING btree ("tenant_id","client_id");--> statement-breakpoint
CREATE INDEX "idx_web_quotes_account" ON "web_quotes" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_web_quotes_status" ON "web_quotes" USING btree ("tenant_id","status","created_at");