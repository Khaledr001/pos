import { and, eq, isNull, or, schema } from "@devsfleet/db";
import { hasPermission, resolveTenantSettings, type PermissionGrant } from "@devsfleet/shared-types";
import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import type { DomainEvent } from "../../common/events/domain-events.js";
import { DOMAIN_EVENTS, type LowStockThresholdCrossedPayload } from "../../common/events/event-names.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { NotificationsGateway } from "./notifications.gateway.js";
import { NotificationsService } from "./notifications.service.js";

/** No fan-out grows unbounded from one movement. Truncate loudly, never silently. */
const MAX_RECIPIENTS = 50;

/**
 * Turns a LOW_STOCK_THRESHOLD_CROSSED event into one notification row per
 * entitled recipient.
 *
 * Runs off StockService.post()'s response path — see DomainEventsInterceptor
 * — so the extra reads here (tenant settings, the variant, its product, the
 * branch, the recipient list) cost nothing on the sale or transfer that
 * triggered the crossing. They would if this ran inline in post().
 */
@Injectable()
export class LowStockNotificationListener {
  private readonly logger = new Logger(LowStockNotificationListener.name);

  constructor(
    private readonly db: TenantDatabase,
    private readonly notifications: NotificationsService,
    private readonly gateway: NotificationsGateway,
  ) {}

  @OnEvent(DOMAIN_EVENTS.LOW_STOCK_THRESHOLD_CROSSED)
  async handle(event: DomainEvent<typeof DOMAIN_EVENTS.LOW_STOCK_THRESHOLD_CROSSED, LowStockThresholdCrossedPayload>): Promise<void> {
    const { tenantId, payload } = event;

    const details = await this.db.runAs(tenantId, async (tx) => {
      const tenant = await tx.query.tenants.findFirst({
        where: (t, { eq: e }) => e(t.id, tenantId),
        columns: { settings: true },
      });

      const variant = await tx.query.productVariants.findFirst({
        where: (t, { eq: e }) => e(t.id, payload.variantId),
        columns: { sku: true, variantName: true, productId: true },
      });
      const product = variant
        ? await tx.query.products.findFirst({
            where: (t, { eq: e }) => e(t.id, variant.productId),
            columns: { name: true },
          })
        : null;
      const branch = await tx.query.branches.findFirst({
        where: (t, { eq: e }) => e(t.id, payload.branchId),
        columns: { name: true },
      });

      const recipients = await tx
        .select({ id: schema.users.id, permissions: schema.roles.permissions })
        .from(schema.users)
        .innerJoin(schema.roles, eq(schema.users.roleId, schema.roles.id))
        .where(
          and(
            eq(schema.users.isActive, true),
            isNull(schema.users.deletedAt),
            or(isNull(schema.users.branchId), eq(schema.users.branchId, payload.branchId)),
          ),
        );

      return { tenant, variant, product, branch, recipients };
    });

    if (!resolveTenantSettings(details.tenant?.settings).inventory.lowStockAlerts) return;

    if (!details.variant || !details.product) {
      this.logger.warn({ payload }, "Low-stock event referenced a variant that no longer exists");
      return;
    }

    const entitled = details.recipients.filter((r) =>
      hasPermission(r.permissions as PermissionGrant[], "inventory:read"),
    );

    if (entitled.length > MAX_RECIPIENTS) {
      this.logger.warn(
        { tenantId, branchId: payload.branchId, variantId: payload.variantId, count: entitled.length },
        `Low-stock recipients truncated to ${MAX_RECIPIENTS}`,
      );
    }

    const label = details.variant.variantName
      ? `${details.product.name} — ${details.variant.variantName}`
      : details.product.name;
    const title = "Low stock";
    const message =
      `${label} (${details.variant.sku}) is at ${payload.available}, at or below the ` +
      `reorder point of ${payload.minStock} at ${details.branch?.name ?? "a branch"}.`;

    for (const recipient of entitled.slice(0, MAX_RECIPIENTS)) {
      try {
        const notification = await this.notifications.notify({
          tenantId,
          userId: recipient.id,
          branchId: payload.branchId,
          type: "low_stock",
          severity: "warning",
          title,
          message,
          referenceType: "product_variant",
          referenceId: payload.variantId,
        });
        this.gateway.pushToUser(tenantId, recipient.id, notification);
      } catch (error) {
        this.logger.error(
          { err: error, userId: recipient.id, variantId: payload.variantId },
          "Failed to write a low-stock notification for one recipient",
        );
      }
    }
  }
}
