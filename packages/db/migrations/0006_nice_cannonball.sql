ALTER TABLE "whatsapp_conversations" ADD COLUMN "whatsapp_account_id" uuid;--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_whatsapp_account_id_whatsapp_accounts_id_fk" FOREIGN KEY ("whatsapp_account_id") REFERENCES "public"."whatsapp_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Backfill: a business with exactly one number answered every existing
-- conversation from it. With several, which number an old conversation came in
-- on was never recorded, so those stay NULL and replies fall back to the
-- business's first active number until the customer next writes.
UPDATE "whatsapp_conversations" c
SET "whatsapp_account_id" = a.id
FROM (
  SELECT tenant_id, min(id::text)::uuid AS id
  FROM "whatsapp_accounts"
  GROUP BY tenant_id
  HAVING count(*) = 1
) a
WHERE a.tenant_id = c.tenant_id AND c."whatsapp_account_id" IS NULL;
