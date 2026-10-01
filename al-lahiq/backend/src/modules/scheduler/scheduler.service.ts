import {
  Inject,
  Injectable,
  Logger,
  Module,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { CronJob } from 'cron';
import { Redis } from 'ioredis';
import { AppConfig } from '../../config/app-config.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { REDIS } from '../../redis/redis.module.js';
import { CatalogIndexer } from '../catalog/catalog-indexer.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { InboundService } from '../pos-sync/inbound.service.js';
import { OutboxService } from '../pos-sync/outbox.service.js';
import { PosClient } from '../pos-sync/pos-client.js';
import { ReconciliationService } from '../pos-sync/reconciliation.service.js';
import { PricingService } from '../pricing/pricing.service.js';

const TZ = 'Asia/Dubai';

/**
 * Background schedule. Each job takes a Redis lock, so with several API
 * instances only one runs it.
 */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly jobs: CronJob[] = [];
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly config: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly reconciliation: ReconciliationService,
    private readonly pos: PosClient,
    private readonly outbox: OutboxService,
    private readonly inbound: InboundService,
    private readonly orders: OrdersService,
    private readonly indexer: CatalogIndexer,
    private readonly pricing: PricingService,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.get('SCHEDULER_ENABLED')) return;

    this.cron('reconciliation', this.config.get('RECONCILIATION_CRON'), 60 * 60_000, async () => {
      if (this.pos.configured) await this.reconciliation.run();
    });
    // Promo lists start and end on the hour; keep "from" prices honest.
    this.cron('catalog-refresh', '5 * * * *', 10 * 60_000, async () => {
      await this.pricing.invalidate();
      await this.indexer.refreshAll();
    });
    this.cron('abandoned-carts', '30 3 * * *', 10 * 60_000, async () => {
      const n = await this.prisma.cart.updateMany({
        where: { status: 'ACTIVE', updatedAt: { lt: new Date(Date.now() - 30 * 86_400_000) } },
        data: { status: 'ABANDONED' },
      });
      if (n.count) this.logger.log(`Marked ${n.count} carts abandoned`);
    });

    this.every('outbox-sweep', 30_000, () => this.outbox.sweep());
    this.every('inbound-sweep', 60_000, () => this.inbound.sweep());
    this.every('expire-unpaid', 5 * 60_000, () => this.orders.expireUnpaid(60));
    this.logger.log('Scheduler started');
  }

  private cron(name: string, expression: string, lockMs: number, fn: () => Promise<unknown>) {
    const job = CronJob.from({
      cronTime: expression,
      timeZone: TZ,
      start: true,
      onTick: () => void this.locked(name, lockMs, fn),
    });
    this.jobs.push(job);
  }

  private every(name: string, ms: number, fn: () => Promise<unknown>) {
    this.timers.push(setInterval(() => void this.locked(name, ms, fn), ms));
  }

  private async locked(name: string, ttlMs: number, fn: () => Promise<unknown>) {
    const key = `lock:job:${name}`;
    const got = await this.redis.set(key, process.pid.toString(), 'PX', ttlMs, 'NX');
    if (!got) return;
    try {
      await fn();
    } catch (err) {
      this.logger.error(`Job ${name} failed: ${(err as Error).message}`);
    } finally {
      await this.redis.del(key);
    }
  }

  onApplicationShutdown() {
    for (const j of this.jobs) void j.stop();
    for (const t of this.timers) clearInterval(t);
  }
}

@Module({ providers: [SchedulerService] })
export class SchedulerModule {}
