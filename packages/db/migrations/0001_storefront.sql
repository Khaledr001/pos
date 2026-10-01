CREATE TABLE "cart_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cart_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"quantity" numeric(12, 4) NOT NULL,
	"seen_unit_price" numeric(12, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ck_cart_items_quantity_positive" CHECK (quantity > 0)
);
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid,
	"status" varchar(10) DEFAULT 'active' NOT NULL,
	"coupon_code" varchar(40),
	"converted_order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" varchar(40) NOT NULL,
	"type" varchar(20) NOT NULL,
	"value" numeric(12, 4) DEFAULT '0' NOT NULL,
	"min_subtotal" numeric(12, 4) DEFAULT '0' NOT NULL,
	"max_uses" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ck_coupons_code_uppercase" CHECK (code = upper(code))
);
--> statement-breakpoint
CREATE TABLE "product_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"linked_product_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ck_product_links_not_self" CHECK (product_id <> linked_product_id)
);
--> statement-breakpoint
CREATE TABLE "product_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"slug" varchar(255) NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"pickup_only" boolean DEFAULT false NOT NULL,
	"seo_title" varchar(255),
	"seo_description" varchar(500),
	"specs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopper_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"phone" varchar(20),
	"company_name" varchar(255),
	"trn" varchar(20),
	"trade_status" varchar(10) DEFAULT 'none' NOT NULL,
	"trade_note" text,
	"last_login_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ck_shopper_accounts_email_lowercase" CHECK (email = lower(email))
);
--> statement-breakpoint
CREATE TABLE "shopper_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"label" varchar(100),
	"full_name" varchar(255) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"emirate" varchar(20) NOT NULL,
	"area" varchar(255) NOT NULL,
	"street" varchar(255) NOT NULL,
	"building" varchar(255),
	"landmark" varchar(255),
	"lat" varchar(20),
	"lng" varchar(20),
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopper_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"quantity" numeric(12, 4) DEFAULT '1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopper_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"is_wishlist" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopper_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storefront_banners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"placement" varchar(20) DEFAULT 'home_hero' NOT NULL,
	"title" varchar(255) NOT NULL,
	"subtitle" varchar(500),
	"image_url" varchar(500),
	"link_url" varchar(500),
	"cta_label" varchar(50),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storefront_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"storefront_id" uuid NOT NULL,
	"domain" varchar(255) NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ck_storefront_domains_lowercase" CHECK (domain = lower(domain))
);
--> statement-breakpoint
CREATE TABLE "storefront_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" varchar(255) NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"kind" varchar(10) DEFAULT 'page' NOT NULL,
	"excerpt" varchar(500),
	"cover_image_url" varchar(500),
	"is_published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"seo_title" varchar(255),
	"seo_description" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storefront_search_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"term" varchar(120) NOT NULL,
	"results" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storefronts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"status" varchar(20) NOT NULL,
	"note" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_orders" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"storefront_id" uuid NOT NULL,
	"account_id" uuid,
	"tracking_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"status" varchar(20) NOT NULL,
	"payment_method" varchar(20) NOT NULL,
	"payment_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"delivery_method" varchar(10) NOT NULL,
	"contact_name" varchar(255) NOT NULL,
	"contact_email" varchar(255) NOT NULL,
	"contact_phone" varchar(20) NOT NULL,
	"company_name" varchar(255),
	"trn" varchar(20),
	"shipping_address" jsonb,
	"pickup_branch_id" uuid,
	"pickup_slot_start" timestamp with time zone,
	"pickup_slot_end" timestamp with time zone,
	"coupon_code" varchar(40),
	"shipping_amount" numeric(12, 4) DEFAULT '0' NOT NULL,
	"weight_kg" numeric(12, 4) DEFAULT '0' NOT NULL,
	"placed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" varchar(30) NOT NULL,
	"provider_ref" varchar(255),
	"method" varchar(20) NOT NULL,
	"amount" numeric(12, 4) NOT NULL,
	"status" varchar(20) NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"courier" varchar(100) NOT NULL,
	"tracking_number" varchar(100),
	"tracking_url" varchar(500),
	"status" varchar(30) DEFAULT 'created' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "is_featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "seo_title" varchar(255);--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "seo_description" varchar(500);--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_account_id_shopper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."shopper_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_converted_order_id_orders_id_fk" FOREIGN KEY ("converted_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_links" ADD CONSTRAINT "product_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_links" ADD CONSTRAINT "product_links_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_links" ADD CONSTRAINT "product_links_linked_product_id_products_id_fk" FOREIGN KEY ("linked_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_listings" ADD CONSTRAINT "product_listings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_listings" ADD CONSTRAINT "product_listings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopper_accounts" ADD CONSTRAINT "shopper_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopper_accounts" ADD CONSTRAINT "shopper_accounts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopper_addresses" ADD CONSTRAINT "shopper_addresses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopper_addresses" ADD CONSTRAINT "shopper_addresses_account_id_shopper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."shopper_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopper_list_items" ADD CONSTRAINT "shopper_list_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopper_list_items" ADD CONSTRAINT "shopper_list_items_list_id_shopper_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."shopper_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopper_list_items" ADD CONSTRAINT "shopper_list_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopper_list_items" ADD CONSTRAINT "shopper_list_items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopper_lists" ADD CONSTRAINT "shopper_lists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopper_lists" ADD CONSTRAINT "shopper_lists_account_id_shopper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."shopper_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopper_sessions" ADD CONSTRAINT "shopper_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopper_sessions" ADD CONSTRAINT "shopper_sessions_account_id_shopper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."shopper_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storefront_banners" ADD CONSTRAINT "storefront_banners_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storefront_domains" ADD CONSTRAINT "storefront_domains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storefront_domains" ADD CONSTRAINT "storefront_domains_storefront_id_storefronts_id_fk" FOREIGN KEY ("storefront_id") REFERENCES "public"."storefronts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storefront_pages" ADD CONSTRAINT "storefront_pages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storefront_search_logs" ADD CONSTRAINT "storefront_search_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storefronts" ADD CONSTRAINT "storefronts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_order_events" ADD CONSTRAINT "web_order_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_order_events" ADD CONSTRAINT "web_order_events_order_id_web_orders_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."web_orders"("order_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_order_events" ADD CONSTRAINT "web_order_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_orders" ADD CONSTRAINT "web_orders_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_orders" ADD CONSTRAINT "web_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_orders" ADD CONSTRAINT "web_orders_storefront_id_storefronts_id_fk" FOREIGN KEY ("storefront_id") REFERENCES "public"."storefronts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_orders" ADD CONSTRAINT "web_orders_account_id_shopper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."shopper_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_orders" ADD CONSTRAINT "web_orders_pickup_branch_id_branches_id_fk" FOREIGN KEY ("pickup_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_payments" ADD CONSTRAINT "web_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_payments" ADD CONSTRAINT "web_payments_order_id_web_orders_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."web_orders"("order_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_shipments" ADD CONSTRAINT "web_shipments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_shipments" ADD CONSTRAINT "web_shipments_order_id_web_orders_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."web_orders"("order_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cart_items" ON "cart_items" USING btree ("cart_id","variant_id","unit_id");--> statement-breakpoint
CREATE INDEX "idx_carts_account" ON "carts" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "idx_carts_updated" ON "carts" USING btree ("tenant_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coupons_tenant_code" ON "coupons" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_product_links" ON "product_links" USING btree ("product_id","linked_product_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_product_listings_product" ON "product_listings" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_product_listings_tenant_slug" ON "product_listings" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "idx_product_listings_published" ON "product_listings" USING btree ("tenant_id","is_published");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_shopper_accounts_tenant_email" ON "shopper_accounts" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_shopper_accounts_customer" ON "shopper_accounts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_shopper_addresses_account" ON "shopper_addresses" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_shopper_list_items" ON "shopper_list_items" USING btree ("list_id","variant_id","unit_id");--> statement-breakpoint
CREATE INDEX "idx_shopper_lists_account" ON "shopper_lists" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_shopper_lists_wishlist" ON "shopper_lists" USING btree ("account_id") WHERE is_wishlist = true;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_shopper_sessions_token" ON "shopper_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_shopper_sessions_family" ON "shopper_sessions" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "idx_storefront_banners_placement" ON "storefront_banners" USING btree ("tenant_id","placement","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_storefront_domains_domain" ON "storefront_domains" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "idx_storefront_domains_storefront" ON "storefront_domains" USING btree ("storefront_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_storefront_pages_tenant_slug" ON "storefront_pages" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "idx_storefront_pages_kind" ON "storefront_pages" USING btree ("tenant_id","kind","is_published");--> statement-breakpoint
CREATE INDEX "idx_storefront_search_logs_created" ON "storefront_search_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_storefronts_tenant" ON "storefronts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_web_order_events_order" ON "web_order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_web_orders_tracking" ON "web_orders" USING btree ("tracking_token");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_web_orders_idempotency" ON "web_orders" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_web_orders_account" ON "web_orders" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_web_orders_status" ON "web_orders" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_web_payments_provider_ref" ON "web_payments" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "idx_web_payments_order" ON "web_payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_web_shipments_order" ON "web_shipments" USING btree ("order_id");