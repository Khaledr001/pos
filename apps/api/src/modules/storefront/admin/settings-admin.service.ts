import { eq, schema, type Transaction } from "@devsfleet/db";
import {
  DEFAULT_STOREFRONT_SETTINGS,
  resolvePlan,
  resolveStorefrontSettings,
  type StorefrontSettings,
} from "@devsfleet/shared-types";
import { AppError, ERROR_CODES, variantSearchKey } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../../common/context/request-context.js";
import { TenantDatabase } from "../../../database/tenant-database.service.js";
import { StorefrontResolver } from "../context/storefront-resolver.service.js";
import type { DomainDto, PaymentAccountDto, SetupStorefrontDto, UpdateSettingsDto } from "./dto.js";

const DELIVERY_SKU = "WEB-DELIVERY";

/** The store's own configuration: domains, delivery, payment, which branches it shows. */
@Injectable()
export class SettingsAdminService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly resolver: StorefrontResolver,
  ) {}

  async get() {
    return this.db.run(async (tx) => {
      const storefront = await tx.query.storefronts.findFirst();
      const tenant = await tx.query.tenants.findFirst({ columns: { planId: true } });
      const planAllows = resolvePlan(tenant?.planId).features.onlineStore;
      if (!storefront) return { storefront: null, planAllows };

      const [domains, account] = await Promise.all([
        tx.query.storefrontDomains.findMany({ orderBy: (t, { desc }) => desc(t.isPrimary) }),
        tx.query.storefrontPaymentAccounts.findFirst({ where: (t, { eq: e }) => e(t.provider, "stripe") }),
      ]);
      return {
        planAllows,
        storefront: { id: storefront.id, name: storefront.name, isActive: storefront.isActive },
        settings: resolveStorefrontSettings(storefront.settings),
        domains: domains.map((d) => ({ id: d.id, domain: d.domain, isPrimary: d.isPrimary })),
        // The secrets themselves are never sent back, only whether they are set.
        paymentAccount: account
          ? {
              provider: account.provider,
              isActive: account.isActive,
              keyHint: `${account.secretKey.slice(0, 8)}…${account.secretKey.slice(-4)}`,
              webhookPath: `/storefront/payments/stripe/webhook/${account.id}`,
            }
          : null,
      };
    });
  }

  /** Create the tenant's storefront, its first domain and the delivery line. */
  async setup(dto: SetupStorefrontDto) {
    const tenantId = RequestContext.requireTenantId();
    await this.db.run(async (tx) => {
      const tenant = await tx.query.tenants.findFirst({ columns: { planId: true } });
      if (!resolvePlan(tenant?.planId).features.onlineStore) {
        throw new AppError(ERROR_CODES.PLAN_LIMIT_EXCEEDED, "Your plan does not include an online store. Upgrade to add one.");
      }
      if (await tx.query.storefronts.findFirst({ columns: { id: true } })) {
        throw new AppError(ERROR_CODES.CONFLICT, "This business already has an online store.");
      }
      await this.assertDomainFree(dto.domain);

      const branches = await tx.query.branches.findMany({
        where: (t, { and: a, eq: e, isNull: n }) => a(e(t.isActive, true), n(t.deletedAt)),
        orderBy: (t, { asc }) => asc(t.name),
      });
      const settings: Partial<StorefrontSettings> = {
        ...DEFAULT_STOREFRONT_SETTINGS,
        checkout: {
          ...DEFAULT_STOREFRONT_SETTINGS.checkout,
          fulfilmentBranchId: branches[0]?.id ?? null,
          deliveryVariantId: await this.ensureDeliveryVariant(tx, tenantId),
        },
        branches: branches.map((b) => ({
          branchId: b.id,
          emirate: "DUBAI",
          lat: null,
          lng: null,
          openingHours: null,
          pickupEnabled: true,
        })),
      };
      const [storefront] = await tx.insert(schema.storefronts).values({ tenantId, name: dto.name, settings }).returning();
      await tx.insert(schema.storefrontDomains).values({ tenantId, storefrontId: storefront!.id, domain: dto.domain, isPrimary: true });
    });
    this.resolver.invalidateTenant(tenantId);
    return this.get();
  }

  async update(dto: UpdateSettingsDto) {
    const tenantId = RequestContext.requireTenantId();
    await this.db.run(async (tx) => {
      const storefront = await this.requireStorefront(tx);
      const current = resolveStorefrontSettings(storefront.settings);
      const { name, isActive, checkout, ...rest } = dto;

      if (checkout?.fulfilmentBranchId) await this.assertBranch(tx, checkout.fulfilmentBranchId);
      for (const branch of dto.branches ?? []) await this.assertBranch(tx, branch.branchId);

      const next: StorefrontSettings = {
        ...current,
        ...rest,
        checkout: {
          ...current.checkout,
          ...checkout,
          cod: { ...current.checkout.cod, ...checkout?.cod },
          card: { ...current.checkout.card, ...checkout?.card },
          // Not editable here: it must stay the tenant's own non-stock delivery line.
          deliveryVariantId: current.checkout.deliveryVariantId ?? (await this.ensureDeliveryVariant(tx, tenantId)),
        },
      };
      await tx
        .update(schema.storefronts)
        .set({ settings: next, ...(name ? { name } : {}), ...(isActive !== undefined ? { isActive } : {}) })
        .where(eq(schema.storefronts.id, storefront.id));
    });
    this.resolver.invalidateTenant(tenantId);
    return this.get();
  }

  async addDomain(dto: DomainDto) {
    const tenantId = RequestContext.requireTenantId();
    await this.assertDomainFree(dto.domain);
    await this.db.run(async (tx) => {
      const storefront = await this.requireStorefront(tx);
      if (dto.isPrimary) await tx.update(schema.storefrontDomains).set({ isPrimary: false }).where(eq(schema.storefrontDomains.storefrontId, storefront.id));
      await tx.insert(schema.storefrontDomains).values({ tenantId, storefrontId: storefront.id, domain: dto.domain, isPrimary: dto.isPrimary });
    });
    this.resolver.invalidateTenant(tenantId);
    return this.get();
  }

  async removeDomain(id: string) {
    const tenantId = RequestContext.requireTenantId();
    await this.db.run(async (tx) => {
      const others = await tx.query.storefrontDomains.findMany({ where: (t, { ne: n }) => n(t.id, id), columns: { id: true } });
      if (others.length === 0) throw new AppError(ERROR_CODES.VALIDATION_FAILED, "A store needs at least one domain.");
      await tx.delete(schema.storefrontDomains).where(eq(schema.storefrontDomains.id, id));
    });
    this.resolver.invalidateTenant(tenantId);
    return this.get();
  }

  async setPaymentAccount(dto: PaymentAccountDto) {
    await this.db.run(async (tx) => {
      const tenantId = RequestContext.requireTenantId();
      await tx
        .insert(schema.storefrontPaymentAccounts)
        .values({ tenantId, provider: "stripe", secretKey: dto.secretKey, webhookSecret: dto.webhookSecret })
        .onConflictDoUpdate({
          target: [schema.storefrontPaymentAccounts.tenantId, schema.storefrontPaymentAccounts.provider],
          set: { secretKey: dto.secretKey, webhookSecret: dto.webhookSecret, isActive: true, updatedAt: new Date() },
        });
    });
    return this.get();
  }

  async removePaymentAccount() {
    await this.db.run((tx) =>
      tx.update(schema.storefrontPaymentAccounts).set({ isActive: false }).where(eq(schema.storefrontPaymentAccounts.provider, "stripe")),
    );
    return this.get();
  }

  // ---------------------------------------------------------------------------

  /** A hostname is unique across EVERY tenant — it is what routes a shopper to one. */
  private async assertDomainFree(domain: string): Promise<void> {
    const tenantId = RequestContext.requireTenantId();
    const taken = await this.db.runAsPlatformAdmin((tx) =>
      tx.query.storefrontDomains.findFirst({
        where: (t, { eq: e }) => e(t.domain, domain),
        columns: { tenantId: true },
      }),
    );
    if (taken) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        taken.tenantId === tenantId ? "This store already uses that domain." : "That domain is already in use by another store.",
      );
    }
  }

  private async assertBranch(tx: Transaction, branchId: string): Promise<void> {
    const branch = await tx.query.branches.findFirst({ where: (t, { eq: e }) => e(t.id, branchId), columns: { id: true } });
    if (!branch) throw new AppError(ERROR_CODES.VALIDATION_FAILED, "One of those branches does not exist.");
  }

  private async requireStorefront(tx: Transaction) {
    const storefront = await tx.query.storefronts.findFirst();
    if (!storefront) throw new AppError(ERROR_CODES.STOREFRONT_NOT_FOUND, "Set up the online store first.");
    return storefront;
  }

  /** The non-stock product a courier fee is invoiced on. One per tenant, never listed. */
  private async ensureDeliveryVariant(tx: Transaction, tenantId: string): Promise<string> {
    const existing = await tx.query.productVariants.findFirst({
      where: (t, { eq: e }) => e(t.sku, DELIVERY_SKU),
      columns: { id: true },
    });
    if (existing) return existing.id;

    const units = await tx.query.units.findMany();
    let unit = units.find((u) => ["pc", "pcs", "piece"].includes(u.abbreviation.toLowerCase())) ?? units[0];
    if (!unit) {
      [unit] = await tx.insert(schema.units).values({ tenantId, name: "Piece", abbreviation: "pc" }).returning();
    }
    const [product] = await tx
      .insert(schema.products)
      .values({ tenantId, sku: DELIVERY_SKU, name: "Delivery", unitId: unit!.id, isStockTracked: false })
      .returning({ id: schema.products.id });
    const [variant] = await tx
      .insert(schema.productVariants)
      .values({ tenantId, productId: product!.id, sku: DELIVERY_SKU, searchKey: variantSearchKey({ productName: "Delivery", sku: DELIVERY_SKU }) })
      .returning({ id: schema.productVariants.id });
    return variant!.id;
  }
}

