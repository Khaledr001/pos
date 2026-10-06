import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../../config/env.js";
import { StockAlertsService } from "./stock-alerts.service.js";

const SWEEP_EVERY_MS = 5 * 60_000;

/**
 * Looks for products that have come back. A plain interval, like
 * PaymentExpiryService, rather than hooking the stock path: the only stock
 * event the platform emits is a low-stock crossing, and "back in stock" can
 * arrive through a receipt, a transfer, a return or a cancelled order's
 * release — a poll catches all of them. Claiming a subscription is a
 * conditional update, so two instances sweeping at once fire it once.
 */
@Injectable()
export class StockAlertSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StockAlertSweepService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly alerts: StockAlertsService,
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
      await this.alerts.sweep();
    } catch (error) {
      this.logger.error({ err: error }, "Back-in-stock sweep failed");
    }
  }
}
