ALTER TABLE "whatsapp_accounts" ALTER COLUMN "verify_token" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ALTER COLUMN "app_secret" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ADD COLUMN "connection_method" varchar(20) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ADD COLUMN "coexistence" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ADD COLUMN "history_sync_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ADD COLUMN "registration_pin" varchar(6);--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD COLUMN "source" varchar(20) DEFAULT 'api' NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ADD CONSTRAINT "ck_wa_accounts_manual_secrets" CHECK (connection_method <> 'manual' OR (app_secret IS NOT NULL AND verify_token IS NOT NULL));