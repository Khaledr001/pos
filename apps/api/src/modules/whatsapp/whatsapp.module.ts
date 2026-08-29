import { Module } from "@nestjs/common";
import { WhatsappController } from "./whatsapp.controller.js";
import { WhatsappService } from "./whatsapp.service.js";

/**
 * Inbound WhatsApp only, for now: verify the signature, resolve the tenant
 * from the number the message arrived on, and store it.
 *
 * `AiModule` is deliberately NOT imported yet. Replying is the next piece and
 * belongs on a queue behind this — the webhook is answered before any model
 * is called, so an LLM's latency can never cost a message.
 */
@Module({
  controllers: [WhatsappController],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
