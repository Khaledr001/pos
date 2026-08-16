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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"client_id" uuid,
	"device_id" uuid,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE UNIQUE INDEX "uq_daily_closings_day" ON "daily_closings" USING btree ("tenant_id","branch_id","closing_date");--> statement-breakpoint
CREATE INDEX "idx_daily_closings_date" ON "daily_closings" USING btree ("tenant_id","closing_date");--> statement-breakpoint
CREATE INDEX "idx_expenses_date" ON "expenses" USING btree ("tenant_id","branch_id","expense_date");--> statement-breakpoint
CREATE INDEX "idx_expenses_category" ON "expenses" USING btree ("tenant_id","category");--> statement-breakpoint
CREATE INDEX "idx_expenses_closing" ON "expenses" USING btree ("daily_closing_id");--> statement-breakpoint
CREATE INDEX "idx_held_carts_user" ON "held_carts" USING btree ("tenant_id","branch_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_held_carts_client_id" ON "held_carts" USING btree ("client_id") WHERE client_id IS NOT NULL;