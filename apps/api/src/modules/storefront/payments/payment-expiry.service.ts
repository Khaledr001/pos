import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../../config/env.js";
import { StorefrontPaymentsService } from "./payments.service.js";
import { PAYMENT_WINDOW_MINUTES } from "./stripe.client.js";

const SWEEP_EVERY_MS = 5 * 60_000;

/**
 * Releases the stock held by card checkouts nobody paid for.
 *
 * A plain interval rather than a queue: cancelling is idempotent (it skips an
 * order that is no longer pending_payment), so two API instances sweeping at
 * once cost a wasted query, not a double cancellation. Waits out the gateway's
 * own window plus a margin, so a payment completing at minute 44 still lands.
 */
@Injectable()
export class PaymentExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentExpiryService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly payments: StorefrontPaymentsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    if (this.config.get("NODE_ENV", { infer: true }) === "test") return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<void> {
    try {
      const expired = await this.payments.expireUnpaid(PAYMENT_WINDOW_MINUTES + 15);
      if (expired > 0) this.logger.log(`Released ${expired} unpaid web order(s)`);
    } catch (error) {
      this.logger.error({ err: error }, "Unpaid web order sweep failed");
    }
  }
}
