import { Module } from "@nestjs/common";
import { WhatsappAdminController } from "./whatsapp-admin.controller.js";
import { WhatsappController } from "./whatsapp.controller.js";
import { WhatsappService } from "./whatsapp.service.js";

/**
 * Two controllers, deliberately: `WhatsappController` holds Meta's two
 * `@Public()` webhook routes, and `WhatsappAdminController` holds the
 * authenticated configuration and inbox routes. Splitting them keeps the
 * unauthenticated surface to exactly two reviewable endpoints.
 *
 * `AiModule` is deliberately NOT imported yet. Replying is the next piece and
 * belongs on a queue behind this — the webhook is answered before any model
 * is called, so an LLM's latency can never cost a message.
 */
@Module({
  controllers: [WhatsappController, WhatsappAdminController],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
