ALTER TABLE "sales" RENAME COLUMN "client_id" TO "local_id";--> statement-breakpoint
ALTER TABLE "cash_movements" RENAME COLUMN "client_id" TO "local_id";--> statement-breakpoint
ALTER TABLE "cash_sessions" RENAME COLUMN "client_id" TO "local_id";--> statement-breakpoint
ALTER TABLE "payments" RENAME COLUMN "client_id" TO "local_id";--> statement-breakpoint
ALTER TABLE "held_carts" RENAME COLUMN "client_id" TO "local_id";--> statement-breakpoint
ALTER TABLE "sync_events" RENAME COLUMN "client_id" TO "local_id";--> statement-breakpoint
DROP INDEX "uq_sales_client_id";--> statement-breakpoint
DROP INDEX "uq_cash_movements_client_id";--> statement-breakpoint
DROP INDEX "uq_cash_sessions_client_id";--> statement-breakpoint
DROP INDEX "uq_payments_client_id";--> statement-breakpoint
DROP INDEX "uq_held_carts_client_id";--> statement-breakpoint
DROP INDEX "uq_sync_events_client";--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "serial_numbers" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "variant_barcodes" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "variant_units" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_prices" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "price_lists" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_prices" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "local_id" uuid;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "sync_status" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_count_items" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "local_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "sync_status" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "local_id" uuid;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "sync_status" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "sync_status" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD COLUMN "sync_status" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD COLUMN "sync_status" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "sync_status" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_closings" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "held_carts" ADD COLUMN "sync_status" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "held_carts" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD COLUMN "branch_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD COLUMN "cash_session_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD COLUMN "local_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD COLUMN "synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD COLUMN "sync_status" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "loyalty_transactions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "formula_components" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "paint_formulas" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "paint_orders" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "document_sequences" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_customers_client" ON "customers" USING btree ("local_id") WHERE local_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sales_client" ON "sales" USING btree ("local_id") WHERE local_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_customer_payments_session" ON "customer_payments" USING btree ("cash_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_customer_payments_local_id" ON "customer_payments" USING btree ("local_id") WHERE local_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cash_movements_client_id" ON "cash_movements" USING btree ("local_id") WHERE local_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cash_sessions_client_id" ON "cash_sessions" USING btree ("local_id") WHERE local_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payments_client_id" ON "payments" USING btree ("local_id") WHERE local_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_held_carts_client_id" ON "held_carts" USING btree ("local_id") WHERE local_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_events_client" ON "sync_events" USING btree ("device_id","local_id","entity_type") WHERE local_id IS NOT NULL;