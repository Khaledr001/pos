CREATE TABLE "storefront_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"storefront_id" uuid NOT NULL,
	"event" varchar(30) NOT NULL,
	"channel" varchar(10) NOT NULL,
	"recipient" varchar(255) NOT NULL,
	"subject_kind" varchar(20) NOT NULL,
	"subject_id" uuid NOT NULL,
	"subject_label" varchar(255) DEFAULT '' NOT NULL,
	"dedupe_key" varchar(160) NOT NULL,
	"status" varchar(10) DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"payload" jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"provider_message_id" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ck_storefront_notifications_attempts" CHECK (attempts >= 0)
);
--> statement-breakpoint
ALTER TABLE "web_orders" ADD COLUMN "whatsapp_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "storefront_notifications" ADD CONSTRAINT "storefront_notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storefront_notifications" ADD CONSTRAINT "storefront_notifications_storefront_id_storefronts_id_fk" FOREIGN KEY ("storefront_id") REFERENCES "public"."storefronts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_storefront_notifications_dedupe" ON "storefront_notifications" USING btree ("tenant_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "idx_storefront_notifications_due" ON "storefront_notifications" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "idx_storefront_notifications_log" ON "storefront_notifications" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_storefront_notifications_subject" ON "storefront_notifications" USING btree ("subject_kind","subject_id");