import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiError } from '../../common/api-error.js';
import { envelopeSchema } from './pos-events.js';
import { PosSignatureGuard } from './pos-signature.guard.js';
import { InboundService } from './inbound.service.js';

@ApiTags('pos')
@Controller('pos')
export class PosWebhookController {
  constructor(private readonly inbound: InboundService) {}

  /**
   * POS → website events. Signed with POS_WEBHOOK_SECRET (see pos-signature.ts).
   * 202 = stored and queued; duplicates (same eventId) are acknowledged and ignored.
   */
  @Post('webhooks')
  @HttpCode(202)
  @SkipThrottle()
  @UseGuards(PosSignatureGuard)
  async receive(@Body() body: unknown) {
    const parsed = envelopeSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest('INVALID_EVENT', 'Event envelope is invalid', parsed.error.issues);
    }
    const status = await this.inbound.receive(parsed.data);
    return { status, eventId: parsed.data.eventId };
  }
}
