CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(20) NOT NULL,
	"address" text,
	"phone" varchar(20),
	"email" varchar(255),
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"plan_id" varchar(30) DEFAULT 'trial' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"subscription_ends_at" timestamp with time zone,
	"payment_customer_id" varchar(100),
	"payment_subscription_id" varchar(100),
	"suspended_at" timestamp with time zone,
	"suspended_reason" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"user_id" uuid,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid,
	"action" varchar(30) NOT NULL,
	"changes" jsonb,
	"reason" text,
	"ip_address" varchar(45),
	"request_id" varchar(64),
	"impersonated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"device_id" uuid,
	"user_agent" text,
	"ip_address" varchar(45),
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_hash" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "refresh_tokens_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"role_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255),
	"phone" varchar(20),
	"pin_hash" varchar(255),
	"password_hash" varchar(255) NOT NULL,
	"locale" varchar(5) DEFAULT 'en' NOT NULL,
	"last_login_at" timestamp with time zone,
	"max_discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"max_sale_amount" numeric(12, 4),
	"can_approve_refund" boolean DEFAULT false NOT NULL,
	"can_view_cost" boolean DEFAULT false NOT NULL,
	"allowed_branch_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "attribute_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"label" varchar(255) NOT NULL,
	"type" varchar(20) NOT NULL,
	"unit" varchar(20),
	"allowed_values" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"logo_url" varchar(500),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"sku_prefix" varchar(16),
	"path" text DEFAULT '' NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"image_url" varchar(500),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"url" varchar(500) NOT NULL,
	"thumbnail_url" varchar(500),
	"checksum" varchar(64) NOT NULL,
	"size_bytes" integer,
	"width" integer,
	"height" integer,
	"mime_type" varchar(50),
	"alt_text" varchar(255),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_name" varchar(255) DEFAULT 'Default' NOT NULL,
	"sku" varchar(64) NOT NULL,
	"barcode" varchar(64),
	"search_key" text DEFAULT '' NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"min_stock" numeric(12, 4) DEFAULT '0' NOT NULL,
	"reorder_quantity" numeric(12, 4) DEFAULT '0' NOT NULL,
	"weight" numeric(12, 4),
	"image_url" varchar(500),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sku" varchar(50) NOT NULL,
	"name" varchar(500) NOT NULL,
	"name_search" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(name, ''))) STORED NOT NULL,
	"name_translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"category_id" uuid,
	"brand_id" uuid,
	"unit_id" uuid NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text,
	"image_url" varchar(500),
	"tax_rate" numeric(12, 4),
	"is_stock_tracked" boolean DEFAULT true NOT NULL,
	"track_serial" boolean DEFAULT false NOT NULL,
	"track_expiry" boolean DEFAULT false NOT NULL,
	"warranty_months" integer,
	"has_variants" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "serial_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"serial" varchar(120) NOT NULL,
	"status" varchar(20) DEFAULT 'available' NOT NULL,
	"branch_id" uuid,
	"sale_item_id" uuid,
	"expiry_date" varchar(10),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(50) NOT NULL,
	"abbreviation" varchar(10) NOT NULL,
	"allows_fractions" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variant_attribute_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"attribute_definition_id" uuid NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variant_barcodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"barcode" varchar(64) NOT NULL,
	"unit_id" uuid,
	"label" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variant_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"conversion_factor" numeric(12, 4) NOT NULL,
	"barcode" varchar(64),
	"price_override" numeric(12, 4),
	"is_sellable" boolean DEFAULT true NOT NULL,
	"is_purchasable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ck_variant_units_factor_positive" CHECK (conversion_factor > 0)
);
--> statement-breakpoint
CREATE TABLE "customer_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"special_price" numeric(12, 4) NOT NULL,
	"notes" text,
	"effective_from" date DEFAULT now() NOT NULL,
	"effective_to" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"price_list_id" uuid NOT NULL,
	"min_quantity" numeric(12, 4) DEFAULT '1' NOT NULL,
	"old_purchase_price" numeric(12, 4),
	"new_purchase_price" numeric(12, 4),
	"old_selling_price" numeric(12, 4),
	"new_selling_price" numeric(12, 4),
	"old_min_selling_price" numeric(12, 4),
	"new_min_selling_price" numeric(12, 4),
	"changed_by" uuid,
	"reason" text,
	"import_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(20) NOT NULL,
	"currency" varchar(3) DEFAULT 'AED' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"price_list_id" uuid NOT NULL,
	"purchase_price" numeric(12, 4),
	"selling_price" numeric(12, 4) NOT NULL,
	"min_selling_price" numeric(12, 4),
	"min_quantity" numeric(12, 4) DEFAULT '1' NOT NULL,
	"effective_from" date DEFAULT now() NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"name" varchar(255) NOT NULL,
	"company" varchar(255),
	"phone" varchar(20),
	"email" varchar(255),
	"trn" varchar(20),
	"address" text,
	"type" varchar(20) DEFAULT 'retail' NOT NULL,
	"locale" varchar(5) DEFAULT 'en' NOT NULL,
	"price_list_id" uuid,
	"credit_limit" numeric(12, 4) DEFAULT '0' NOT NULL,
	"credit_balance" numeric(12, 4) DEFAULT '0' NOT NULL,
	"payment_term_days" integer DEFAULT 0 NOT NULL,
	"credit_on_hold" boolean DEFAULT false NOT NULL,
	"loyalty_points" integer DEFAULT 0 NOT NULL,
	"whatsapp_phone" varchar(20),
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"local_id" uuid,
	"device_id" uuid,
	"synced_at" timestamp with time zone,
	"sync_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"company" varchar(255),
	"phone" varchar(20),
	"email" varchar(255),
	"trn" varchar(20),
	"address" text,
	"payment_term_days" integer DEFAULT 0 NOT NULL,
	"outstanding_balance" numeric(12, 4) DEFAULT '0' NOT NULL,
	"contact_person" varchar(255),
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"quantity" numeric(12, 4) DEFAULT '0' NOT NULL,
	"reserved_quantity" numeric(12, 4) DEFAULT '0' NOT NULL,
	"reorder_level" numeric(12, 4) DEFAULT '0' NOT NULL,
	"reorder_quantity" numeric(12, 4) DEFAULT '0' NOT NULL,
	"average_cost" numeric(12, 4),
	"bin_location" varchar(50),
	"last_counted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"type" varchar(30) NOT NULL,
	"quantity" numeric(12, 4) NOT NULL,
	"balance_after" numeric(12, 4) NOT NULL,
	"unit_cost" numeric(12, 4),
	"reference_type" varchar(30),
	"reference_id" uuid,
	"notes" text,
	"created_by" uuid,
	"device_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_count_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"stock_count_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"system_quantity" numeric(12, 4) NOT NULL,
	"counted_quantity" numeric(12, 4),
	"variance" numeric(12, 4),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"count_number" varchar(30) NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"category_id" uuid,
	"counted_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_transfer_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"transfer_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"requested_quantity" numeric(12, 4) NOT NULL,
	"shipped_quantity" numeric(12, 4),
	"received_quantity" numeric(12, 4),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"transfer_number" varchar(30) NOT NULL,
	"from_branch_id" uuid NOT NULL,
	"to_branch_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'requested' NOT NULL,
	"requested_by" uuid,
	"approved_by" uuid,
	"shipped_by" uuid,
	"received_by" uuid,
	"approved_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_name" varchar(500) NOT NULL,
	"variant_name" varchar(255) DEFAULT 'Default' NOT NULL,
	"product_sku" varchar(64) NOT NULL,
	"unit_id" uuid,
	"unit_conversion_factor" numeric(12, 4) DEFAULT '1' NOT NULL,
	"quantity" numeric(12, 4) NOT NULL,
	"unit_price" numeric(12, 4) NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(12, 4) DEFAULT '0' NOT NULL,
	"tax_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(12, 4) DEFAULT '0' NOT NULL,
	"line_subtotal" numeric(12, 4) DEFAULT '0' NOT NULL,
	"total" numeric(12, 4) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"fulfilled_quantity" numeric(12, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"order_number" varchar(30) NOT NULL,
	"customer_id" uuid,
	"quotation_id" uuid,
	"source" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"currency" varchar(3) DEFAULT 'AED' NOT NULL,
	"exchange_rate" numeric(12, 4) DEFAULT '1' NOT NULL,
	"tax_mode" varchar(10) DEFAULT 'exclusive' NOT NULL,
	"subtotal" numeric(12, 4) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(12, 4) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(12, 4) DEFAULT '0' NOT NULL,
	"total" numeric(12, 4) DEFAULT '0' NOT NULL,
	"stock_reserved" timestamp with time zone,
	"expected_ready_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"notes" text,
	"created_by" uuid,
	"conversation_id" uuid,
	"local_id" uuid,
	"device_id" uuid,
	"synced_at" timestamp with time zone,
	"sync_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quotation_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_name" varchar(500) NOT NULL,
	"variant_name" varchar(255) DEFAULT 'Default' NOT NULL,
	"product_sku" varchar(64) NOT NULL,
	"unit_id" uuid,
	"unit_conversion_factor" numeric(12, 4) DEFAULT '1' NOT NULL,
	"quantity" numeric(12, 4) NOT NULL,
	"unit_price" numeric(12, 4) NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(12, 4) DEFAULT '0' NOT NULL,
	"tax_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(12, 4) DEFAULT '0' NOT NULL,
	"line_subtotal" numeric(12, 4) DEFAULT '0' NOT NULL,
	"total" numeric(12, 4) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"quotation_number" varchar(30) NOT NULL,
	"customer_id" uuid,
	"source" varchar(20) DEFAULT 'manual' NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"currency" varchar(3) DEFAULT 'AED' NOT NULL,
	"exchange_rate" numeric(12, 4) DEFAULT '1' NOT NULL,
	"tax_mode" varchar(10) DEFAULT 'exclusive' NOT NULL,
	"subtotal" numeric(12, 4) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(12, 4) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(12, 4) DEFAULT '0' NOT NULL,
	"total" numeric(12, 4) DEFAULT '0' NOT NULL,
	"valid_until" date,
	"notes" text,
	"terms_text" text,
	"pdf_url" varchar(500),
	"converted_to_order_id" uuid,
	"converted_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_by" uuid,
	"conversation_id" uuid,
	"local_id" uuid,
	"device_id" uuid,
	"synced_at" timestamp with time zone,
	"sync_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_name" varchar(500) NOT NULL,
	"variant_name" varchar(255) DEFAULT 'Default' NOT NULL,
	"product_sku" varchar(64) NOT NULL,
	"unit_id" uuid,
	"unit_conversion_factor" numeric(12, 4) DEFAULT '1' NOT NULL,
	"quantity" numeric(12, 4) NOT NULL,
	"unit_price" numeric(12, 4) NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(12, 4) DEFAULT '0' NOT NULL,
	"tax_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(12, 4) DEFAULT '0' NOT NULL,
	"line_subtotal" numeric(12, 4) DEFAULT '0' NOT NULL,
	"total" numeric(12, 4) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"cost_price" numeric(12, 4),
	"floor_price_overridden_by" uuid,
	"returned_quantity" numeric(12, 4) DEFAULT '0' NOT NULL,
	"return_disposition" varchar(10),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sale_number" varchar(30) NOT NULL,
	"order_id" uuid,
	"customer_id" uuid,
	"cash_session_id" uuid,
	"source" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'completed' NOT NULL,
	"currency" varchar(3) DEFAULT 'AED' NOT NULL,
	"exchange_rate" numeric(12, 4) DEFAULT '1' NOT NULL,
	"tax_mode" varchar(10) DEFAULT 'exclusive' NOT NULL,
	"subtotal" numeric(12, 4) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(12, 4) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(12, 4) DEFAULT '0' NOT NULL,
	"total" numeric(12, 4) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(12, 4) DEFAULT '0' NOT NULL,
	"due_amount" numeric(12, 4) DEFAULT '0' NOT NULL,
	"return_of_sale_id" uuid,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"notes" text,
	"created_by" uuid,
	"local_id" uuid,
	"device_id" uuid,
	"synced_at" timestamp with time zone,
	"sync_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_offline" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cash_session_id" uuid NOT NULL,
	"type" varchar(20) NOT NULL,
	"amount" numeric(12, 4) NOT NULL,
	"reason" text,
	"reference_type" varchar(30),
	"reference_id" uuid,
	"created_by" uuid,
	"local_id" uuid,
	"device_id" uuid,
	"synced_at" timestamp with time zone,
	"sync_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"session_number" varchar(30) NOT NULL,
	"opening_amount" numeric(12, 4) NOT NULL,
	"closing_amount" numeric(12, 4),
	"expected_amount" numeric(12, 4),
	"difference" numeric(12, 4),
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"notes" text,
	"local_id" uuid,
	"device_id" uuid,
	"synced_at" timestamp with time zone,
	"sync_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sale_id" uuid,
	"customer_id" uuid,
	"cash_session_id" uuid,
	"method" varchar(20) NOT NULL,
	"amount" numeric(12, 4) NOT NULL,
	"currency" varchar(3) DEFAULT 'AED' NOT NULL,
	"exchange_rate" numeric(12, 4) DEFAULT '1' NOT NULL,
	"tendered_amount" numeric(12, 4),
	"change_amount" numeric(12, 4),
	"reference" varchar(100),
	"clearing_date" timestamp with time zone,
	"notes" text,
	"created_by" uuid,
	"local_id" uuid,
	"device_id" uuid,
	"synced_at" timestamp with time zone,
	"sync_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_closings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"closing_date" date NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"opening_float" numeric(12, 4) DEFAULT '0' NOT NULL,
	"total_sales" numeric(12, 4),
	"total_returns" numeric(12, 4),
	"total_expenses" numeric(12, 4),
	"cash_total" numeric(12, 4),
	"card_total" numeric(12, 4),
	"bank_total" numeric(12, 4),
	"credit_total" numeric(12, 4),
	"sale_count" integer,
	"expected_cash" numeric(12, 4),
	"counted_cash" numeric(12, 4),
	"cash_variance" numeric(12, 4),
	"notes" text,
	"opened_by" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"amount" numeric(12, 4) NOT NULL,
	"category" varchar(80),
	"expense_date" date NOT NULL,
	"payment_method" varchar(20) DEFAULT 'cash' NOT NULL,
	"notes" text,
	"user_id" uuid NOT NULL,
	"daily_closing_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "held_carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"label" varchar(80),
	"cart_data" jsonb NOT NULL,
	"line_count" integer DEFAULT 0 NOT NULL,
	"total" numeric(12, 4) DEFAULT '0' NOT NULL,
	"customer_id" uuid,
	"user_id" uuid NOT NULL,
	"local_id" uuid,
	"device_id" uuid,
	"synced_at" timestamp with time zone,
	"sync_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"amount" numeric(12, 4) NOT NULL,
	"method" varchar(20) NOT NULL,
	"cash_session_id" uuid,
	"reference_number" varchar(80),
	"notes" text,
	"created_by" uuid,
	"local_id" uuid,
	"device_id" uuid,
	"synced_at" timestamp with time zone,
	"sync_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goods_receipt_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"goods_receipt_id" uuid NOT NULL,
	"purchase_order_item_id" uuid,
	"variant_id" uuid NOT NULL,
	"unit_id" uuid,
	"unit_conversion_factor" numeric(12, 4) DEFAULT '1' NOT NULL,
	"quantity" numeric(12, 4) NOT NULL,
	"landed_unit_cost" numeric(12, 4),
	"damaged_quantity" numeric(12, 4) DEFAULT '0' NOT NULL,
	"batch_number" varchar(50),
	"expiry_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ck_grn_items_factor_positive" CHECK (unit_conversion_factor > 0)
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"purchase_order_id" uuid,
	"supplier_id" uuid NOT NULL,
	"grn_number" varchar(30) NOT NULL,
	"supplier_invoice_number" varchar(100),
	"supplier_invoice_date" date,
	"received_by" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "purchase_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_name" varchar(500) NOT NULL,
	"variant_name" varchar(255) DEFAULT 'Default' NOT NULL,
	"product_sku" varchar(64) NOT NULL,
	"unit_id" uuid,
	"unit_conversion_factor" numeric(12, 4) DEFAULT '1' NOT NULL,
	"quantity" numeric(12, 4) NOT NULL,
	"received_quantity" numeric(12, 4) DEFAULT '0' NOT NULL,
	"unit_price" numeric(12, 4) NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(12, 4) DEFAULT '0' NOT NULL,
	"line_subtotal" numeric(12, 4) DEFAULT '0' NOT NULL,
	"total" numeric(12, 4) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ck_po_items_factor_positive" CHECK (unit_conversion_factor > 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"po_number" varchar(30) NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"currency" varchar(3) DEFAULT 'AED' NOT NULL,
	"exchange_rate" numeric(12, 4) DEFAULT '1' NOT NULL,
	"tax_mode" varchar(10) DEFAULT 'exclusive' NOT NULL,
	"subtotal" numeric(12, 4) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(12, 4) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(12, 4) DEFAULT '0' NOT NULL,
	"shipping_amount" numeric(12, 4) DEFAULT '0' NOT NULL,
	"total" numeric(12, 4) DEFAULT '0' NOT NULL,
	"expected_date" date,
	"sent_at" timestamp with time zone,
	"supplier_reference" varchar(100),
	"notes" text,
	"created_by" uuid,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid,
	"action_type" varchar(30) NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"status" varchar(20) DEFAULT 'completed' NOT NULL,
	"error_message" text,
	"model" varchar(50),
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"estimated_cost" numeric(12, 4),
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"phone_number_id" varchar(64) NOT NULL,
	"display_phone_number" varchar(20),
	"business_account_id" varchar(64),
	"access_token" text NOT NULL,
	"verify_token" varchar(128) NOT NULL,
	"app_secret" varchar(128) NOT NULL,
	"default_branch_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid,
	"phone_number" varchar(20) NOT NULL,
	"profile_name" varchar(255),
	"branch_id" uuid,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"locale" varchar(5) DEFAULT 'en' NOT NULL,
	"assigned_to" uuid,
	"assigned_at" timestamp with time zone,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_turn_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone,
	"window_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"wa_message_id" varchar(100),
	"direction" varchar(10) NOT NULL,
	"type" varchar(20) DEFAULT 'text' NOT NULL,
	"content" text,
	"media_url" varchar(500),
	"media_mime_type" varchar(100),
	"template_name" varchar(100),
	"template_payload" jsonb,
	"status" varchar(20),
	"error_code" varchar(50),
	"error_message" text,
	"is_ai_generated" boolean DEFAULT false NOT NULL,
	"sent_by" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" varchar(20) DEFAULT 'pos' NOT NULL,
	"hardware_id" varchar(128),
	"activation_code" varchar(32),
	"activated_at" timestamp with time zone,
	"app_version" varchar(20),
	"last_seen_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_checkpoint" varchar(64),
	"offline_stock_allocation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hardware_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" varchar(64) NOT NULL,
	"current_value" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"direction" varchar(10) NOT NULL,
	"entity_type" varchar(30) NOT NULL,
	"entity_id" uuid,
	"local_id" uuid,
	"sequence" bigint,
	"payload" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"conflict_data" jsonb,
	"error_code" varchar(50),
	"error_message" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"branch_id" uuid,
	"type" varchar(30) NOT NULL,
	"severity" varchar(10) DEFAULT 'info' NOT NULL,
	"title" varchar(200) NOT NULL,
	"message" text NOT NULL,
	"reference_type" varchar(40),
	"reference_id" uuid,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_impersonated_by_users_id_fk" FOREIGN KEY ("impersonated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribute_definitions" ADD CONSTRAINT "attribute_definitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribute_definitions" ADD CONSTRAINT "attribute_definitions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_attribute_values" ADD CONSTRAINT "variant_attribute_values_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_attribute_values" ADD CONSTRAINT "variant_attribute_values_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_attribute_values" ADD CONSTRAINT "variant_attribute_values_attribute_definition_id_attribute_definitions_id_fk" FOREIGN KEY ("attribute_definition_id") REFERENCES "public"."attribute_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_barcodes" ADD CONSTRAINT "variant_barcodes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_barcodes" ADD CONSTRAINT "variant_barcodes_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_barcodes" ADD CONSTRAINT "variant_barcodes_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_units" ADD CONSTRAINT "variant_units_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_units" ADD CONSTRAINT "variant_units_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_units" ADD CONSTRAINT "variant_units_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_prices" ADD CONSTRAINT "customer_prices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_prices" ADD CONSTRAINT "customer_prices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_prices" ADD CONSTRAINT "customer_prices_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_prices" ADD CONSTRAINT "customer_prices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_stock_count_id_stock_counts_id_fk" FOREIGN KEY ("stock_count_id") REFERENCES "public"."stock_counts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_counted_by_users_id_fk" FOREIGN KEY ("counted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_transfer_id_stock_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."stock_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_branch_id_branches_id_fk" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_branch_id_branches_id_fk" FOREIGN KEY ("to_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_shipped_by_users_id_fk" FOREIGN KEY ("shipped_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_floor_price_overridden_by_users_id_fk" FOREIGN KEY ("floor_price_overridden_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_cash_session_id_cash_sessions_id_fk" FOREIGN KEY ("cash_session_id") REFERENCES "public"."cash_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_return_of_sale_id_sales_id_fk" FOREIGN KEY ("return_of_sale_id") REFERENCES "public"."sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_cash_session_id_cash_sessions_id_fk" FOREIGN KEY ("cash_session_id") REFERENCES "public"."cash_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_closings" ADD CONSTRAINT "daily_closings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_closings" ADD CONSTRAINT "daily_closings_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_closings" ADD CONSTRAINT "daily_closings_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_closings" ADD CONSTRAINT "daily_closings_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_daily_closing_id_daily_closings_id_fk" FOREIGN KEY ("daily_closing_id") REFERENCES "public"."daily_closings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "held_carts" ADD CONSTRAINT "held_carts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "held_carts" ADD CONSTRAINT "held_carts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "held_carts" ADD CONSTRAINT "held_carts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "held_carts" ADD CONSTRAINT "held_carts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_goods_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("goods_receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_purchase_order_item_id_purchase_order_items_id_fk" FOREIGN KEY ("purchase_order_item_id") REFERENCES "public"."purchase_order_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_supplier_links" ADD CONSTRAINT "product_supplier_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_supplier_links" ADD CONSTRAINT "product_supplier_links_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_supplier_links" ADD CONSTRAINT "product_supplier_links_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_conversation_id_whatsapp_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."whatsapp_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_message_id_whatsapp_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."whatsapp_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ADD CONSTRAINT "whatsapp_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ADD CONSTRAINT "whatsapp_accounts_default_branch_id_branches_id_fk" FOREIGN KEY ("default_branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_conversation_id_whatsapp_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."whatsapp_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_branches_tenant" ON "branches" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_branches_tenant_code" ON "branches" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "idx_tenants_slug" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_tenants_plan" ON "tenants" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "idx_audit_tenant_created" ON "audit_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_entity" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_audit_user" ON "audit_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_impersonated" ON "audit_log" USING btree ("impersonated_by","created_at") WHERE impersonated_by is not null;--> statement-breakpoint
CREATE INDEX "idx_refresh_user" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_refresh_expires" ON "refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_roles_tenant_name" ON "roles" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_users_tenant_email" ON "users" USING btree ("tenant_id","email") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_users_tenant_branch" ON "users" USING btree ("tenant_id","branch_id");--> statement-breakpoint
CREATE INDEX "idx_users_role" ON "users" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_attribute_definitions_category_name" ON "attribute_definitions" USING btree ("category_id","name");--> statement-breakpoint
CREATE INDEX "idx_attribute_definitions_tenant" ON "attribute_definitions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_brands_tenant_slug" ON "brands" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_categories_tenant_slug" ON "categories" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "idx_categories_parent" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_categories_path" ON "categories" USING btree ("tenant_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_product_images_tenant_checksum" ON "product_images" USING btree ("tenant_id","checksum");--> statement-breakpoint
CREATE INDEX "idx_product_images_product" ON "product_images" USING btree ("product_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_product_images_primary" ON "product_images" USING btree ("product_id") WHERE is_primary = true;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_variants_tenant_sku" ON "product_variants" USING btree ("tenant_id","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_variants_tenant_barcode" ON "product_variants" USING btree ("tenant_id","barcode") WHERE barcode IS NOT NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_variants_product" ON "product_variants" USING btree ("product_id","sort_order");--> statement-breakpoint
CREATE INDEX "idx_variants_trgm" ON "product_variants" USING gin ("search_key" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_variants_updated" ON "product_variants" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_products_tenant_sku" ON "products" USING btree ("tenant_id","sku");--> statement-breakpoint
CREATE INDEX "idx_products_search" ON "products" USING gin ("tenant_id","name_search");--> statement-breakpoint
CREATE INDEX "idx_products_category" ON "products" USING btree ("tenant_id","category_id");--> statement-breakpoint
CREATE INDEX "idx_products_brand" ON "products" USING btree ("tenant_id","brand_id");--> statement-breakpoint
CREATE INDEX "idx_products_updated" ON "products" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_serials_tenant_serial" ON "serial_numbers" USING btree ("tenant_id","serial");--> statement-breakpoint
CREATE INDEX "idx_serials_variant_status" ON "serial_numbers" USING btree ("variant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_units_tenant_abbr" ON "units" USING btree ("tenant_id","abbreviation");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_variant_attribute_values_variant_def" ON "variant_attribute_values" USING btree ("variant_id","attribute_definition_id");--> statement-breakpoint
CREATE INDEX "idx_variant_attribute_values_lookup" ON "variant_attribute_values" USING btree ("attribute_definition_id","value");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_variant_barcodes_tenant_code" ON "variant_barcodes" USING btree ("tenant_id","barcode");--> statement-breakpoint
CREATE INDEX "idx_variant_barcodes_variant" ON "variant_barcodes" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_variant_units" ON "variant_units" USING btree ("variant_id","unit_id");--> statement-breakpoint
CREATE INDEX "idx_variant_units_variant" ON "variant_units" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_customer_prices_effective" ON "customer_prices" USING btree ("customer_id","variant_id","effective_from");--> statement-breakpoint
CREATE INDEX "idx_customer_prices_current" ON "customer_prices" USING btree ("customer_id","variant_id") WHERE effective_to IS NULL;--> statement-breakpoint
CREATE INDEX "idx_price_history_variant" ON "price_history" USING btree ("variant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_price_history_tenant_created" ON "price_history" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_price_lists_tenant" ON "price_lists" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_price_lists_default" ON "price_lists" USING btree ("tenant_id") WHERE is_default = true;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_product_prices_effective" ON "product_prices" USING btree ("variant_id","price_list_id","min_quantity","effective_from");--> statement-breakpoint
CREATE INDEX "idx_product_prices_current" ON "product_prices" USING btree ("variant_id","price_list_id","min_quantity") WHERE effective_to IS NULL;--> statement-breakpoint
CREATE INDEX "idx_product_prices_list" ON "product_prices" USING btree ("price_list_id");--> statement-breakpoint
CREATE INDEX "idx_customers_tenant_phone" ON "customers" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_customers_tenant_whatsapp" ON "customers" USING btree ("tenant_id","whatsapp_phone") WHERE whatsapp_phone IS NOT NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_customers_client" ON "customers" USING btree ("local_id") WHERE local_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_customers_tenant_name" ON "customers" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "idx_customers_updated" ON "customers" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "idx_customers_credit" ON "customers" USING btree ("tenant_id","credit_balance") WHERE credit_balance > 0;--> statement-breakpoint
CREATE INDEX "idx_suppliers_tenant_name" ON "suppliers" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "idx_suppliers_tenant_phone" ON "suppliers" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_inventory_variant_branch" ON "inventory" USING btree ("variant_id","branch_id");--> statement-breakpoint
CREATE INDEX "idx_inventory_branch" ON "inventory" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "idx_inventory_updated" ON "inventory" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "idx_inventory_low_stock" ON "inventory" USING btree ("branch_id","variant_id") WHERE quantity - reserved_quantity <= reorder_level;--> statement-breakpoint
CREATE INDEX "idx_inv_tx_variant_branch" ON "inventory_transactions" USING btree ("variant_id","branch_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_inv_tx_reference" ON "inventory_transactions" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "idx_inv_tx_tenant_created" ON "inventory_transactions" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_stock_count_items" ON "stock_count_items" USING btree ("stock_count_id","variant_id");--> statement-breakpoint
CREATE INDEX "idx_stock_count_items_count" ON "stock_count_items" USING btree ("stock_count_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_stock_counts_number" ON "stock_counts" USING btree ("tenant_id","count_number");--> statement-breakpoint
CREATE INDEX "idx_stock_counts_branch" ON "stock_counts" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "idx_transfer_items_transfer" ON "stock_transfer_items" USING btree ("transfer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_stock_transfers_number" ON "stock_transfers" USING btree ("tenant_id","transfer_number");--> statement-breakpoint
CREATE INDEX "idx_transfers_from" ON "stock_transfers" USING btree ("from_branch_id","status");--> statement-breakpoint
CREATE INDEX "idx_transfers_to" ON "stock_transfers" USING btree ("to_branch_id","status");--> statement-breakpoint
CREATE INDEX "idx_order_items_order" ON "order_items" USING btree ("order_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_orders_number" ON "orders" USING btree ("tenant_id","order_number");--> statement-breakpoint
CREATE INDEX "idx_orders_customer" ON "orders" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_orders_branch_status" ON "orders" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "idx_orders_tenant_created" ON "orders" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_quotation_items_quotation" ON "quotation_items" USING btree ("quotation_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_quotations_number" ON "quotations" USING btree ("tenant_id","quotation_number");--> statement-breakpoint
CREATE INDEX "idx_quotations_customer" ON "quotations" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_quotations_branch_status" ON "quotations" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "idx_quotations_tenant_created" ON "quotations" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_sale_items_sale" ON "sale_items" USING btree ("sale_id","sort_order");--> statement-breakpoint
CREATE INDEX "idx_sale_items_variant" ON "sale_items" USING btree ("variant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sales_number" ON "sales" USING btree ("tenant_id","sale_number");--> statement-breakpoint
CREATE INDEX "idx_sales_branch_occurred" ON "sales" USING btree ("branch_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_sales_customer" ON "sales" USING btree ("customer_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_sales_tenant_occurred" ON "sales" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_sales_cash_session" ON "sales" USING btree ("cash_session_id");--> statement-breakpoint
CREATE INDEX "idx_sales_device" ON "sales" USING btree ("device_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sales_client" ON "sales" USING btree ("local_id") WHERE local_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_cash_movements_session" ON "cash_movements" USING btree ("cash_session_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cash_movements_client_id" ON "cash_movements" USING btree ("local_id") WHERE local_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cash_sessions_number" ON "cash_sessions" USING btree ("tenant_id","session_number");--> statement-breakpoint
CREATE INDEX "idx_cash_sessions_branch_status" ON "cash_sessions" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "idx_cash_sessions_user" ON "cash_sessions" USING btree ("user_id","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cash_sessions_client_id" ON "cash_sessions" USING btree ("local_id") WHERE local_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_payments_sale" ON "payments" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "idx_payments_customer" ON "payments" USING btree ("customer_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_payments_branch_occurred" ON "payments" USING btree ("branch_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_payments_cash_session" ON "payments" USING btree ("cash_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payments_client_id" ON "payments" USING btree ("local_id") WHERE local_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_daily_closings_day" ON "daily_closings" USING btree ("tenant_id","branch_id","closing_date");--> statement-breakpoint
CREATE INDEX "idx_daily_closings_date" ON "daily_closings" USING btree ("tenant_id","closing_date");--> statement-breakpoint
CREATE INDEX "idx_expenses_date" ON "expenses" USING btree ("tenant_id","branch_id","expense_date");--> statement-breakpoint
CREATE INDEX "idx_expenses_category" ON "expenses" USING btree ("tenant_id","category");--> statement-breakpoint
CREATE INDEX "idx_expenses_closing" ON "expenses" USING btree ("daily_closing_id");--> statement-breakpoint
CREATE INDEX "idx_held_carts_user" ON "held_carts" USING btree ("tenant_id","branch_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_held_carts_client_id" ON "held_carts" USING btree ("local_id") WHERE local_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_customer_payments_customer" ON "customer_payments" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_customer_payments_session" ON "customer_payments" USING btree ("cash_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_customer_payments_local_id" ON "customer_payments" USING btree ("local_id") WHERE local_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_loyalty_customer" ON "loyalty_transactions" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_loyalty_reference" ON "loyalty_transactions" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "idx_formula_components_formula" ON "formula_components" USING btree ("formula_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_paint_formulas_code_size" ON "paint_formulas" USING btree ("tenant_id","color_code","size_ml");--> statement-breakpoint
CREATE INDEX "idx_paint_formulas_search" ON "paint_formulas" USING btree ("tenant_id","color_name");--> statement-breakpoint
CREATE INDEX "idx_paint_orders_branch" ON "paint_orders" USING btree ("branch_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_grn_items_grn" ON "goods_receipt_items" USING btree ("goods_receipt_id");--> statement-breakpoint
CREATE INDEX "idx_grn_items_variant" ON "goods_receipt_items" USING btree ("variant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_goods_receipts_number" ON "goods_receipts" USING btree ("tenant_id","grn_number");--> statement-breakpoint
CREATE INDEX "idx_grn_po" ON "goods_receipts" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "idx_grn_branch_received" ON "goods_receipts" USING btree ("branch_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_product_supplier_links_supplier_variant" ON "product_supplier_links" USING btree ("supplier_id","variant_id");--> statement-breakpoint
CREATE INDEX "idx_product_supplier_links_barcode" ON "product_supplier_links" USING btree ("supplier_id","supplier_barcode") WHERE supplier_barcode IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_product_supplier_links_sku" ON "product_supplier_links" USING btree ("supplier_id","supplier_sku") WHERE supplier_sku IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_product_supplier_links_variant" ON "product_supplier_links" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "idx_po_items_po" ON "purchase_order_items" USING btree ("purchase_order_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_purchase_orders_number" ON "purchase_orders" USING btree ("tenant_id","po_number");--> statement-breakpoint
CREATE INDEX "idx_po_supplier" ON "purchase_orders" USING btree ("supplier_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_po_branch_status" ON "purchase_orders" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "idx_ai_actions_conversation" ON "ai_actions" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_actions_tenant_type" ON "ai_actions" USING btree ("tenant_id","action_type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wa_accounts_phone_number_id" ON "whatsapp_accounts" USING btree ("phone_number_id");--> statement-breakpoint
CREATE INDEX "idx_wa_accounts_tenant" ON "whatsapp_accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wa_conversations_tenant_phone" ON "whatsapp_conversations" USING btree ("tenant_id","phone_number");--> statement-breakpoint
CREATE INDEX "idx_wa_conversations_status" ON "whatsapp_conversations" USING btree ("tenant_id","status","last_message_at");--> statement-breakpoint
CREATE INDEX "idx_wa_conversations_customer" ON "whatsapp_conversations" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wa_messages_wa_id" ON "whatsapp_messages" USING btree ("wa_message_id") WHERE wa_message_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_wa_messages_conversation" ON "whatsapp_messages" USING btree ("conversation_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_devices_tenant_name" ON "devices" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_devices_hardware" ON "devices" USING btree ("hardware_id");--> statement-breakpoint
CREATE INDEX "idx_devices_branch" ON "devices" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_document_sequences" ON "document_sequences" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_events_client" ON "sync_events" USING btree ("device_id","local_id","entity_type") WHERE local_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_sync_events_device_created" ON "sync_events" USING btree ("device_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_sync_events_status" ON "sync_events" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_user_unread" ON "notifications" USING btree ("user_id","is_read","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_notifications_dedupe" ON "notifications" USING btree ("user_id","type","reference_type","reference_id") WHERE is_read = false and reference_id is not null;