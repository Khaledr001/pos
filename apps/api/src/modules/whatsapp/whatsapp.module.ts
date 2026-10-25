import { Module } from "@nestjs/common";
import { EmbeddedSignupService } from "./embedded-signup.service.js";
import { WhatsappAdminController } from "./whatsapp-admin.controller.js";
import { WhatsappController } from "./whatsapp.controller.js";
import { WhatsappSetupService } from "./whatsapp-setup.service.js";
import { WhatsappService } from "./whatsapp.service.js";
import { WhatsappTemplateService } from "./whatsapp-template.service.js";

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
  providers: [WhatsappService, WhatsappTemplateService, WhatsappSetupService, EmbeddedSignupService],
  exports: [WhatsappService, WhatsappTemplateService],
})
export class WhatsappModule {}
