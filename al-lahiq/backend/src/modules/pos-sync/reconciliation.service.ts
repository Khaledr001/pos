import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CatalogIndexer } from '../catalog/catalog-indexer.service.js';
import { PricingService } from '../pricing/pricing.service.js';
import { RevalidationService } from '../revalidation/revalidation.service.js';
import { PosClient } from './pos-client.js';
import { PosEventHandler } from './pos-event-handler.service.js';

export interface ReconciliationSummary {
  products: { applied: number; unchanged: number };
  stock: { fixed: number; unknown: number };
  priceLists: { applied: number };
  prices: { fixed: number; removed: number };
}

/**
 * Nightly full comparison with the POS. Pulls a snapshot and applies it with
 * force, which fixes anything a missed webhook left behind.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pos: PosClient,
    private readonly handler: PosEventHandler,
    private readonly indexer: CatalogIndexer,
    private readonly pricing: PricingService,
    private readonly revalidation: RevalidationService,
  ) {}

  async run() {
    if (this.running) return null;
    this.running = true;
    const run = await this.prisma.syncRun.create({ data: { kind: 'reconciliation' } });
    try {
      const snap = await this.pos.snapshot();
      const summary: ReconciliationSummary = {
        products: { applied: 0, unchanged: 0 },
        stock: { fixed: 0, unknown: 0 },
        priceLists: { applied: 0 },
        prices: { fixed: 0, removed: 0 },
      };

      for (const p of snap.products) {
        const r = await this.handler.applyProduct(p, true);
        summary.products[r === 'applied' ? 'applied' : 'unchanged']++;
      }
      if (snap.stock.length) {
        const s = await this.handler.applyStock(snap.stock, true);
        summary.stock = { fixed: s.applied, unknown: s.unknown };
      }
      for (const { items, ...list } of snap.priceLists) {
        if ((await this.handler.applyPriceList(list, true)) === 'applied') summary.priceLists.applied++;
        const r = await this.handler.replacePriceItems(list.code, items);
        summary.prices.fixed += r.fixed;
        summary.prices.removed += r.removed;
      }

      await this.pricing.invalidate();
      await this.indexer.refreshAll();
      this.revalidation.revalidate(RevalidationService.tags.catalog, RevalidationService.tags.home);

      await this.prisma.syncRun.update({
        where: { id: run.id },
        data: { status: 'SUCCEEDED', summary: summary as object, finishedAt: new Date() },
      });
      this.logger.log(`Reconciliation done: ${JSON.stringify(summary)}`);
      return summary;
    } catch (err) {
      const message = (err as Error).message;
      await this.prisma.syncRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', error: message.slice(0, 2000), finishedAt: new Date() },
      });
      this.logger.error(`Reconciliation failed: ${message}`);
      throw err;
    } finally {
      this.running = false;
    }
  }
}
