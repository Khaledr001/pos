import { and, count, eq, inArray, schema, sql } from "@devsfleet/db";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable, Logger } from "@nestjs/common";
import { RequestContext } from "../../../common/context/request-context.js";
import { TenantDatabase } from "../../../database/tenant-database.service.js";
import { StorefrontCatalogService, type StockLabel } from "../catalog/storefront-catalog.service.js";
import { currentShopper } from "../context/storefront.guard.js";
import { StorefrontResolver } from "../context/storefront-resolver.service.js";
import type { SubscribeStockAlertDto } from "./dto.js";

const SWEEP_TENANT_LIMIT = 200;
const SWEEP_ROW_LIMIT = 500;

/** Variants whose free stock is above zero again, given what is pending. Pure, so it is testable without a database. */
export function backInStock<T extends { variantId: string }>(
  pending: T[],
  availability: Map<string, { label: StockLabel }>,
): T[] {
  return pending.filter((row) => {
    const stock = availability.get(row.variantId);
    return !!stock && stock.label !== "OUT_OF_STOCK";
  });
}

/**
 * "Tell me when it is back" — subscriptions, the sweep that fires them and the
 * staff view of demand.
 *
 * DELIVERY: there is no email transport in the platform and WhatsApp can only
 * send free text inside a customer-service window a stranger has not opened,
 * so nothing is sent to the shopper yet. The sweep records that the alert
 * fired (`status = notified`, `notified_at`) and leaves `delivered_at` null;
 * it is the single place a transport plugs in. Pretending otherwise would tell
 * a shopper we emailed them.
 */
@Injectable()
export class StockAlertsService {
  private readonly logger = new Logger(StockAlertsService.name);

  constructor(
    private readonly db: TenantDatabase,
    private readonly catalog: StorefrontCatalogService,
    private readonly resolver: StorefrontResolver,
  ) {}

  /**
   * Always answers `{ subscribed: true }` for a well-formed request: the same
   * reply for a new address, one already waiting and a bot's honeypot hit, so
   * the endpoint cannot be used to learn who has asked about what.
   */
  async subscribe(dto: SubscribeStockAlertDto): Promise<{ subscribed: true }> {
    if (dto.website) return { subscribed: true };

    const accountId = currentShopper()?.accountId ?? null;
    await this.db.run(async (tx) => {
      const [variant] = await tx
        .select({ id: schema.productVariants.id, productId: schema.productVariants.productId })
        .from(schema.productVariants)
        .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
        .innerJoin(schema.productListings, eq(schema.productListings.productId, schema.products.id))
        .where(
          and(
            eq(schema.productVariants.id, dto.variantId),
            eq(schema.productVariants.isActive, true),
            sql`${schema.productVariants.deletedAt} IS NULL`,
            eq(schema.products.isActive, true),
            sql`${schema.products.deletedAt} IS NULL`,
            eq(schema.productListings.isPublished, true),
          ),
        );
      if (!variant) throw new AppError(ERROR_CODES.PRODUCT_NOT_FOUND, "That product is not available online.");

      const table = schema.stockAlertSubscriptions;
      await tx
        .insert(table)
        .values({
          tenantId: RequestContext.requireTenantId(),
          productId: variant.productId,
          variantId: variant.id,
          email: dto.email,
          phone: dto.phone ?? null,
          accountId,
        })
        // A repeat is the same row. One that already fired starts waiting again,
        // so the next time the product runs out and returns they hear about it.
        .onConflictDoUpdate({
          target: [table.tenantId, table.variantId, table.email],
          set: {
            status: "pending",
            notifiedAt: null,
            deliveredAt: null,
            phone: sql`coalesce(excluded.phone, ${table.phone})`,
            accountId: sql`coalesce(excluded.account_id, ${table.accountId})`,
          },
        });
    });
    return { subscribed: true };
  }

  /** The link in an alert. Same answer whether or not the token matched. */
  async unsubscribe(token: string): Promise<{ unsubscribed: true }> {
    await this.db.run((tx) =>
      tx
        .update(schema.stockAlertSubscriptions)
        .set({ status: "cancelled" })
        .where(
          and(eq(schema.stockAlertSubscriptions.unsubscribeToken, token), sql`${schema.stockAlertSubscriptions.status} <> 'cancelled'`),
        ),
    );
    return { unsubscribed: true };
  }

  /** Staff: which products people are waiting for, most wanted first. */
  async demand() {
    return this.db.run(async (tx) => {
      const waiting = count(schema.stockAlertSubscriptions.id);
      const rows = await tx
        .select({
          productId: schema.products.id,
          productName: schema.products.name,
          waiting,
          variants: sql<number>`count(distinct ${schema.stockAlertSubscriptions.variantId})::int`,
          oldest: sql<string>`min(${schema.stockAlertSubscriptions.createdAt})`,
        })
        .from(schema.stockAlertSubscriptions)
        .innerJoin(schema.products, eq(schema.products.id, schema.stockAlertSubscriptions.productId))
        .where(eq(schema.stockAlertSubscriptions.status, "pending"))
        .groupBy(schema.products.id, schema.products.name)
        .orderBy(sql`${waiting} desc`, schema.products.name)
        .limit(200);
      return {
        items: rows.map((r) => ({ productId: r.productId, productName: r.productName, waiting: r.waiting, variants: r.variants, oldest: r.oldest })),
      };
    });
  }

  /**
   * Fire the alerts whose product has stock again. Called on an interval.
   * Returns how many subscriptions fired.
   *
   * "In stock" is exactly the storefront's own answer (`availability`: free
   * stock less the safety buffer, at the branches the shop shows), so an alert
   * never fires for stock the product page would still call sold out.
   */
  async sweep(): Promise<number> {
    const tenants = await this.db.runAsPlatformAdmin((tx) =>
      tx
        .selectDistinct({ tenantId: schema.stockAlertSubscriptions.tenantId })
        .from(schema.stockAlertSubscriptions)
        .where(eq(schema.stockAlertSubscriptions.status, "pending"))
        .limit(SWEEP_TENANT_LIMIT),
    );

    let fired = 0;
    for (const { tenantId } of tenants) {
      const storefront = await this.resolver.forTenant(tenantId);
      if (!storefront) continue;
      fired += await RequestContext.run({ requestId: `stock-alerts-${tenantId}`, startedAt: Date.now() }, async () => {
        RequestContext.setStorefront(storefront);
        return this.fireForTenant();
      });
    }
    return fired;
  }

  private async fireForTenant(): Promise<number> {
    return this.db.run(async (tx) => {
      const pending = await tx
        .select({
          id: schema.stockAlertSubscriptions.id,
          variantId: schema.stockAlertSubscriptions.variantId,
          minStock: schema.productVariants.minStock,
          tracked: schema.products.isStockTracked,
        })
        .from(schema.stockAlertSubscriptions)
        .innerJoin(schema.productVariants, eq(schema.productVariants.id, schema.stockAlertSubscriptions.variantId))
        .innerJoin(schema.products, eq(schema.products.id, schema.stockAlertSubscriptions.productId))
        .innerJoin(schema.productListings, eq(schema.productListings.productId, schema.products.id))
        .where(
          and(
            eq(schema.stockAlertSubscriptions.status, "pending"),
            eq(schema.productListings.isPublished, true),
            eq(schema.productVariants.isActive, true),
            eq(schema.products.isActive, true),
          ),
        )
        .limit(SWEEP_ROW_LIMIT);
      if (pending.length === 0) return 0;

      const context = await this.catalog.listingContext(tx);
      const availability = new Map<string, { label: StockLabel }>();
      for (const tracked of [true, false]) {
        const group = pending.filter((p) => p.tracked === tracked);
        const unique = [...new Map(group.map((p) => [p.variantId, { id: p.variantId, minStock: p.minStock }])).values()];
        for (const [id, stock] of await this.catalog.availability(tx, unique, tracked, context)) availability.set(id, stock);
      }

      const due = backInStock(pending, availability);
      if (due.length === 0) return 0;

      // Claimed in the same statement that fires them, so two API instances
      // sweeping at once cannot both announce the same subscription.
      const claimed = await tx
        .update(schema.stockAlertSubscriptions)
        .set({ status: "notified", notifiedAt: new Date() })
        .where(
          and(
            inArray(schema.stockAlertSubscriptions.id, due.map((d) => d.id)),
            eq(schema.stockAlertSubscriptions.status, "pending"),
          ),
        )
        .returning({ id: schema.stockAlertSubscriptions.id });

      this.logger.log(`${claimed.length} back-in-stock alert(s) fired; no transport configured, nothing was sent to shoppers`);
      return claimed.length;
    });
  }
}
