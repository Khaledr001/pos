import {
  Body,
  Controller,
  Global,
  HttpCode,
  Logger,
  Module,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { IsIn } from 'class-validator';
import type Stripe from 'stripe';
import { ApiError } from '../../common/api-error.js';
import type { AppRequest } from '../../common/auth.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { DevPayProvider } from './dev-pay.provider.js';
import { PaymentsService } from './payments.service.js';
import { StripeProvider } from './stripe.provider.js';

export class DevPayDto {
  @IsIn(['success', 'fail'])
  outcome: 'success' | 'fail';
}

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly stripe: StripeProvider,
    private readonly devPay: DevPayProvider,
    private readonly prisma: PrismaService,
  ) {}

  @Post('stripe/webhook')
  @HttpCode(200)
  @SkipThrottle()
  async stripeWebhook(@Req() req: AppRequest) {
    let event: Stripe.Event;
    try {
      event = this.stripe.parseWebhook(req.rawBody!, req.header('stripe-signature'));
    } catch (err) {
      throw new ApiError(400, 'INVALID_SIGNATURE', (err as Error).message);
    }

    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object;
      if (session.payment_status === 'paid') {
        await this.payments.confirmPaid('stripe', session.id, session.amount_total ?? 0, {
          eventId: event.id,
          paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : null,
        });
      }
    } else if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
      await this.payments.markFailed('stripe', event.data.object.id);
    }
    return { received: true };
  }

  /** Completes a fake payment. Only when DEV_PAYMENTS=true outside production. */
  @Post('dev/:ref/complete')
  @HttpCode(200)
  async devComplete(@Param('ref') ref: string, @Body() dto: DevPayDto) {
    if (!this.devPay.enabled) throw ApiError.notFound('Route');
    const payment = await this.prisma.payment.findUnique({
      where: { provider_providerRef: { provider: 'devpay', providerRef: ref } },
      include: { order: { select: { trackingToken: true } } },
    });
    if (!payment) throw ApiError.notFound('Payment');
    if (dto.outcome === 'success') {
      await this.payments.confirmPaid('devpay', ref, payment.amountFils, { dev: true });
    } else {
      await this.payments.markFailed('devpay', ref);
    }
    this.logger.log(`Dev payment ${ref}: ${dto.outcome}`);
    return { status: dto.outcome, trackingToken: payment.order.trackingToken };
  }
}

@Global()
@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, StripeProvider, DevPayProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
