import { Global, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service.js';

/**
 * Tells the Next.js frontend which cached pages to refresh.
 * Tags are batched for a short window so a bulk POS update causes one call.
 * Failures are logged, not thrown: a stale page is better than a failed sync.
 */
@Injectable()
export class RevalidationService implements OnModuleDestroy {
  private readonly logger = new Logger(RevalidationService.name);
  private pending = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly config: AppConfig) {}

  static tags = {
    catalog: 'catalog',
    home: 'home',
    content: 'content',
    sku: (sku: string) => `sku:${sku}`,
    product: (slug: string) => `product:${slug}`,
    category: (slug: string) => `category:${slug}`,
    brand: (slug: string) => `brand:${slug}`,
    page: (slug: string) => `page:${slug}`,
  };

  revalidate(...tags: string[]) {
    for (const t of tags) this.pending.add(t);
    if (!this.timer && this.config.get('NODE_ENV') !== 'test') {
      this.timer = setTimeout(() => void this.flush(), 300);
    }
  }

  async flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const tags = [...this.pending];
    this.pending.clear();
    if (!tags.length) return;
    try {
      const res = await fetch(`${this.config.get('FRONTEND_URL')}/api/revalidate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-revalidate-secret': this.config.get('REVALIDATE_SECRET'),
        },
        body: JSON.stringify({ tags }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) this.logger.warn(`Revalidate returned ${res.status}`);
    } catch (err) {
      this.logger.warn(`Revalidate failed: ${(err as Error).message}`);
    }
  }

  /** Test hook. */
  drain(): string[] {
    const tags = [...this.pending];
    this.pending.clear();
    return tags;
  }

  async onModuleDestroy() {
    await this.flush();
  }
}

@Global()
@Module({ providers: [RevalidationService], exports: [RevalidationService] })
export class RevalidationModule {}
