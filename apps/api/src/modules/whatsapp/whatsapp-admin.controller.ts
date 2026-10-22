import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Audited, RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import {
  ConnectWebhookSchema,
  CreateWhatsappAccountSchema,
  RetestWhatsappAccountSchema,
  TestWhatsappConnectionSchema,
  type RetestWhatsappAccountDto,
  type ConnectWebhookDto,
  type TestWhatsappConnectionDto,
  ListConversationsSchema,
  SendWhatsappMessageSchema,
  UpdateWhatsappAccountSchema,
  type CreateWhatsappAccountDto,
  type ListConversationsDto,
  type SendWhatsappMessageDto,
  type UpdateWhatsappAccountDto,
} from "./dto.js";
import { WhatsappSetupService } from "./whatsapp-setup.service.js";
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
  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly setup: WhatsappSetupService,
  ) {}

  // ── Configuration ──────────────────────────────────────────────────────────

  @Get("accounts")
  @RequirePermissions("settings:read")
  @ApiOperation({ summary: "Configured WhatsApp numbers. Secrets are never returned." })
  listAccounts() {
    return this.whatsapp.listAccounts();
  }

  /**
   * Declared before `accounts/:id` routes. Checks credentials against Meta
   * without saving them — a failed check comes back as `ok: false` with a
   * plain-language reason, not as an error.
   */
  @Post("accounts/test")
  @RequirePermissions("settings:write")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Check a token, phone number id and app secret with Meta before saving" })
  testConnection(@Body(zodPipe(TestWhatsappConnectionSchema)) dto: TestWhatsappConnectionDto) {
    return this.setup.testConnection(dto);
  }

  @Post("accounts")
  @RequirePermissions("settings:write")
  @Audited("whatsapp_accounts", "create")
  @ApiOperation({ summary: "Register a Meta Cloud API number for this tenant" })
  async createAccount(@Body(zodPipe(CreateWhatsappAccountSchema)) dto: CreateWhatsappAccountDto) {
    // Fill what Meta can tell us, so the account list shows the real number.
    // Best effort: an unreachable Meta must not stop a save the operator chose.
    const known =
      dto.displayPhoneNumber && dto.businessAccountId
        ? {}
        : await this.setup
            .enrich({ accessToken: dto.accessToken, appSecret: dto.appSecret, phoneNumberId: dto.phoneNumberId })
            .catch(() => ({}));
    return this.whatsapp.createAccount({ ...known, ...dto });
  }

  @Post("accounts/:id/test")
  @RequirePermissions("settings:write")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Re-check a saved number, optionally with a replacement token or secret" })
  retest(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(RetestWhatsappAccountSchema)) dto: RetestWhatsappAccountDto,
  ) {
    return this.setup.retest(id, dto);
  }

  @Post("accounts/:id/connect-webhook")
  @RequirePermissions("settings:write")
  @Audited("whatsapp_accounts", "connect_webhook")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Point the Meta app's webhook here and subscribe the business account to it" })
  connectWebhook(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(ConnectWebhookSchema)) dto: ConnectWebhookDto,
  ) {
    return this.setup.connectWebhook(id, dto.callbackUrl);
  }

  @Get("accounts/:id/status")
  @RequirePermissions("settings:read")
  @ApiOperation({ summary: "Re-check a saved number with Meta: token validity, expiry, webhook" })
  accountStatus(@Param("id", ParseUUIDPipe) id: string) {
    return this.setup.status(id);
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
