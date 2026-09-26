import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Audited, RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import {
  CreateWhatsappAccountSchema,
  ListConversationsSchema,
  SendWhatsappMessageSchema,
  UpdateWhatsappAccountSchema,
  type CreateWhatsappAccountDto,
  type ListConversationsDto,
  type SendWhatsappMessageDto,
  type UpdateWhatsappAccountDto,
} from "./dto.js";
import { WhatsappService } from "./whatsapp.service.js";

/**
 * The authenticated half of WhatsApp — configuration and the human inbox.
 *
 * Separate from `WhatsappController`, which carries Meta's two `@Public()`
 * webhook routes and is excluded from Swagger. Keeping them apart means the
 * public surface stays exactly two routes that anyone can reach, reviewable
 * at a glance, instead of being mixed in with a dozen that need a token.
 *
 * Two different permissions on purpose: reading and replying to a customer is
 * day-to-day counter work (`whatsapp:*`), while the API credentials behind
 * the number are business configuration (`settings:*`). A supervisor who
 * handles escalations should not thereby be able to read or rotate the
 * access token for the company's WhatsApp line.
 */
@ApiTags("whatsapp")
@Controller("whatsapp")
export class WhatsappAdminController {
  constructor(private readonly whatsapp: WhatsappService) {}

  // ── Configuration ──────────────────────────────────────────────────────────

  @Get("accounts")
  @RequirePermissions("settings:read")
  @ApiOperation({ summary: "Configured WhatsApp numbers. Secrets are never returned." })
  listAccounts() {
    return this.whatsapp.listAccounts();
  }

  @Post("accounts")
  @RequirePermissions("settings:write")
  @Audited("whatsapp_accounts", "create")
  @ApiOperation({ summary: "Register a Meta Cloud API number for this tenant" })
  createAccount(@Body(zodPipe(CreateWhatsappAccountSchema)) dto: CreateWhatsappAccountDto) {
    return this.whatsapp.createAccount(dto);
  }

  @Patch("accounts/:id")
  @RequirePermissions("settings:write")
  @Audited("whatsapp_accounts", "update")
  @ApiOperation({ summary: "Update a number. Omitted secrets keep their stored value." })
  updateAccount(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(UpdateWhatsappAccountSchema)) dto: UpdateWhatsappAccountDto,
  ): Promise<void> {
    return this.whatsapp.updateAccount(id, dto);
  }

  @Delete("accounts/:id")
  @RequirePermissions("settings:write")
  @Audited("whatsapp_accounts", "delete")
  @ApiOperation({ summary: "Remove a number. Conversations and messages are kept." })
  deleteAccount(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.whatsapp.deleteAccount(id);
  }

  // ── Inbox ──────────────────────────────────────────────────────────────────

  @Get("conversations")
  @RequirePermissions("whatsapp:read")
  @ApiOperation({ summary: "Conversations, newest activity first" })
  listConversations(@Query(zodPipe(ListConversationsSchema)) query: ListConversationsDto) {
    return this.whatsapp.listConversations(query);
  }

  @Get("conversations/:id")
  @RequirePermissions("whatsapp:read")
  @ApiOperation({ summary: "One conversation with its full message history" })
  getConversation(@Param("id", ParseUUIDPipe) id: string) {
    return this.whatsapp.getConversation(id);
  }

  @Post("conversations/:id/messages")
  @RequirePermissions("whatsapp:reply")
  @Audited("whatsapp_messages", "send")
  @ApiOperation({
    summary: "Send a text reply. Refused once the 24-hour window has closed.",
  })
  send(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(SendWhatsappMessageSchema)) dto: SendWhatsappMessageDto,
  ) {
    return this.whatsapp.sendText(id, dto.body);
  }
}
