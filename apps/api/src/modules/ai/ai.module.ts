import { Module } from "@nestjs/common";
import { LlmService } from "./llm.service.js";

/**
 * The AI module today is exactly one thing: a DeepSeek chat-completion
 * client. No controller, no webhook, no conversation state — those belong to
 * the WhatsApp module (Phase 4 / Stage 8), which will import `LlmService`
 * rather than duplicate it. Deliberately no `dto.ts`: there is no HTTP
 * boundary here to validate against, which is also why this module departs
 * from the usual five-file shape in `modules/README.md`.
 */
@Module({
  providers: [LlmService],
  exports: [LlmService],
})
export class AiModule {}
