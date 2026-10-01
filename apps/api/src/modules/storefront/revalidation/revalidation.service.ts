import { eq, schema, sql, type Transaction } from "@devsfleet/db";
import { resolveStorefrontSettings } from "@devsfleet/shared-types";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../../config/env.js";
import { TenantDatabase } from "../../../database/tenant-database.service.js";

const EVERY_MS = 30_000;
const MAX_TAGS = 500;

/**
 * Tells each storefront which of its cached pages went stale.
 *
 * The only thing that still resembles "sync" between the POS and the shop,
 * and it carries no data — just cache tags. A missed push means a page shows
 * yesterday's price until its TTL runs out, never that an order is charged
 * it: checkout always re-prices from the database.
 *
 * Driven by `updated_at`, which a trigger maintains on every row (see
 * sql/triggers.sql), so a price changed at the till, in the admin panel, by
 * the importer or by a hand-written SQL fix is all seen the same way — none
 * of them has to remember to announce it.
 */
@Injectable()
export class RevalidationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RevalidationService.name);
  private readonly secret: string | undefined;
  private readonly enabled: boolean;
  /** Per storefront: the database clock at the last successful push, as raw text (see PATTERNS: never via Date). */
  private readonly marks = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: TenantDatabase,
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get("STOREFRONT_REVALIDATE_SECRET", { infer: true });
    this.enabled = !!this.secret && config.get("NODE_ENV", { infer: true }) !== "test";
  }

  onModuleInit(): void {
    if (!this.enabled) return;
    this.timer = setInterval(() => void this.tick(), EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const storefronts = await this.db.runAsPlatformAdmin((tx) =>
        tx
          .select({ id: schema.storefronts.id, tenantId: schema.storefronts.tenantId, settings: schema.storefronts.settings })
          .from(schema.storefronts)
          .where(eq(schema.storefronts.isActive, true)),
      );
      for (const storefront of storefronts) {
        const url = resolveStorefrontSettings(storefront.settings).revalidateUrl;
        if (!url) continue;
        await this.push(storefront.id, storefront.tenantId, url).catch((error) =>
          this.logger.warn({ err: error, storefrontId: storefront.id }, "Revalidation push failed; will retry"),
        );
      }
    } finally {
      this.running = false;
    }
  }

  private async push(storefrontId: string, tenantId: string, url: string): Promise<void> {
    const { tags, now } = await this.db.runAs(tenantId, async (tx) => {
      const [clock] = await tx.execute<{ now: string }>(sql`SELECT now()::text AS now`);
      const since = this.marks.get(storefrontId);
      // First sight of this storefront: start from now, nothing to announce yet.
      return { tags: since ? await this.staleTags(tx, since) : [], now: clock!.now };
    });

    if (tags.length > 0) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-revalidate-secret": this.secret! },
        body: JSON.stringify({ tags: tags.slice(0, MAX_TAGS) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`revalidate answered ${response.status}`);
    }
    // Only moved on success, so a failed push is retried with the same window.
    this.marks.set(storefrontId, now);
  }

  /** Cache tags for everything that changed since `since`. Names match the storefront's lib/api-server.ts. */
  private async staleTags(tx: Transaction, since: string): Promise<string[]> {
    const products = await tx.execute<{ slug: string }>(sql`
      SELECT DISTINCT l.slug FROM product_listings l
      WHERE l.updated_at > ${since}::timestamptz
         OR EXISTS (SELECT 1 FROM products p WHERE p.id = l.product_id AND p.updated_at > ${since}::timestamptz)
         OR EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = l.product_id AND v.updated_at > ${since}::timestamptz)
         OR EXISTS (SELECT 1 FROM product_variants v JOIN product_prices pp ON pp.variant_id = v.id
                    WHERE v.product_id = l.product_id AND pp.updated_at > ${since}::timestamptz)
         OR EXISTS (SELECT 1 FROM product_variants v JOIN inventory i ON i.variant_id = v.id
                    WHERE v.product_id = l.product_id AND i.updated_at > ${since}::timestamptz)
      LIMIT ${MAX_TAGS}`);
    const [categories, brands, pages, banners] = await Promise.all([
      tx.execute<{ slug: string }>(sql`SELECT slug FROM categories WHERE updated_at > ${since}::timestamptz`),
      tx.execute<{ slug: string }>(sql`SELECT slug FROM brands WHERE updated_at > ${since}::timestamptz`),
      tx.execute<{ slug: string }>(sql`SELECT slug FROM storefront_pages WHERE updated_at > ${since}::timestamptz`),
      tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM storefront_banners WHERE updated_at > ${since}::timestamptz`),
    ]);

    const tags = new Set<string>();
    for (const p of products) tags.add(`product:${p.slug}`);
    for (const c of categories) tags.add(`category:${c.slug}`);
    for (const b of brands) tags.add(`brand:${b.slug}`);
    for (const p of pages) tags.add(`page:${p.slug}`);
    // Listings, filters and the home page all show prices and stock.
    if (products.length || categories.length || brands.length) {
      tags.add("catalog");
      tags.add("home");
    }
    if (pages.length || Number(banners[0]?.n ?? 0) > 0) {
      tags.add("content");
      tags.add("home");
    }
    return [...tags];
  }
}
