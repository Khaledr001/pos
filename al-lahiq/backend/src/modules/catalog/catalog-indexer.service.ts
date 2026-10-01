import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService, Tx } from '../../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

/**
 * Keeps products.fromNetPriceFils and products.inStock in step with the POS
 * copy, so listings can filter and sort by price and stock in plain SQL.
 * "From" price = lowest public (retail or promo) base-unit price at qty 1.
 */
@Injectable()
export class CatalogIndexer {
  private readonly logger = new Logger(CatalogIndexer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async refreshProducts(productIds: string[], tx?: Tx) {
    if (!productIds.length) return;
    await this.run(Prisma.sql`p.id = ANY(${productIds}::uuid[])`, tx);
  }

  async refreshBySkus(skus: string[], tx?: Tx) {
    if (!skus.length) return;
    await this.run(
      Prisma.sql`p.id IN (SELECT "productId" FROM variants WHERE sku = ANY(${skus}::text[]))`,
      tx,
    );
  }

  /** Hourly safety net, also catches promo lists starting or ending. */
  async refreshAll() {
    const n = await this.run(Prisma.sql`TRUE`);
    this.logger.log(`Refreshed ${n} products`);
  }

  private async run(where: Prisma.Sql, tx?: Tx) {
    const db = tx ?? this.prisma;
    const { safetyBuffer } = await this.settings.get('stock', tx);
    return db.$executeRaw`
      UPDATE products p SET
        "fromNetPriceFils" = (
          SELECT MIN(pli."netPriceFils")
          FROM variants v
          JOIN price_list_items pli
            ON pli.sku = v.sku AND pli.uom = v."baseUom" AND pli."minQty" <= 1
          JOIN price_lists pl ON pl.id = pli."priceListId"
          WHERE v."productId" = p.id AND v.active
            AND pl.active AND pl.type IN ('RETAIL', 'PROMO')
            AND pl.channel IN ('ALL', 'ONLINE')
            AND (pl."validFrom" IS NULL OR pl."validFrom" <= now())
            AND (pl."validTo" IS NULL OR pl."validTo" >= now())
        ),
        "inStock" = EXISTS (
          SELECT 1
          FROM variants v
          JOIN stock_levels s ON s."variantId" = v.id
          JOIN branches b ON b.id = s."branchId"
          WHERE v."productId" = p.id AND v.active AND b.active
            AND s.quantity > ${safetyBuffer}
        )
      WHERE ${where}`;
  }
}
