import { eq, schema, type Transaction } from "@devsfleet/db";
import {
  DEFAULT_STOREFRONT_SETTINGS,
  resolvePlan,
  resolveStorefrontSettings,
  resolveTenantSettings,
  type StorefrontSettings,
} from "@devsfleet/shared-types";
import { AppError, ERROR_CODES, variantSearchKey } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RequestContext } from "../../../common/context/request-context.js";
import type { Env } from "../../../config/env.js";
import { TenantDatabase } from "../../../database/tenant-database.service.js";
import { StorefrontResolver } from "../context/storefront-resolver.service.js";
import { assertZonesConsistent, defaultRegionCode, defaultShippingRates, regionPreset } from "../region.js";
import { checkStorefrontHostname, subdomainLabelProblem, suggestSubdomainLabel } from "../platform-subdomain.js";
import type { DomainDto, PaymentAccountDto, SetupStorefrontDto, UpdateSettingsDto } from "./dto.js";

const DELIVERY_SKU = "WEB-DELIVERY";

/** The store's own configuration: domains, delivery, payment, which branches it shows. */
@Injectable()
export class SettingsAdminService {
  private readonly baseDomain: string | null;

  constructor(
    private readonly db: TenantDatabase,
    private readonly resolver: StorefrontResolver,
    config: ConfigService<Env, true>,
  ) {
    this.baseDomain = config.get("STOREFRONT_BASE_DOMAIN", { infer: true }) ?? null;
  }

  /** What the admin needs to offer a free `<name>.<base>` address, before and after setup. */
  private platformDomain(tenantName: string | undefined) {
    return {
      baseDomain: this.baseDomain,
      suggestedLabel: this.baseDomain && tenantName ? suggestSubdomainLabel(tenantName) || null : null,
    };
  }

  async get() {
    return this.db.run(async (tx) => {
      const storefront = await tx.query.storefronts.findFirst();
      const tenant = await tx.query.tenants.findFirst({ columns: { planId: true, name: true } });
      const planAllows = resolvePlan(tenant?.planId).features.onlineStore;
      // Headless access is the plan's API access; the admin disables the switch without it.
      const planAllowsHeadless = resolvePlan(tenant?.planId).features.apiAccess;
      const platform = this.platformDomain(tenant?.name);
      if (!storefront) return { storefront: null, planAllows, planAllowsHeadless, platform };

      const [domains, account] = await Promise.all([
        tx.query.storefrontDomains.findMany({ orderBy: (t, { desc }) => desc(t.isPrimary) }),
        tx.query.storefrontPaymentAccounts.findFirst({ where: (t, { eq: e }) => e(t.provider, "stripe") }),
      ]);
      return {
        planAllows,
        planAllowsHeadless,
        platform,
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
      const tenant = await tx.query.tenants.findFirst({ columns: { planId: true, settings: true } });
      if (!resolvePlan(tenant?.planId).features.onlineStore) {
        throw new AppError(ERROR_CODES.PLAN_LIMIT_EXCEEDED, "Your plan does not include an online store. Upgrade to add one.");
      }
      const tenantSettings = resolveTenantSettings(tenant?.settings);
      const region = regionPreset(dto.region ?? defaultRegionCode(tenantSettings.currency.base, tenantSettings.locale.timezone));
      if (await tx.query.storefronts.findFirst({ columns: { id: true } })) {
        throw new AppError(ERROR_CODES.CONFLICT, "This business already has an online store.");
      }
      this.assertDomainAllowed(dto.domain);
      await this.assertDomainFree(dto.domain);

      const branches = await tx.query.branches.findMany({
        where: (t, { and: a, eq: e, isNull: n }) => a(e(t.isActive, true), n(t.deletedAt)),
        orderBy: (t, { asc }) => asc(t.name),
      });
      const settings: Partial<StorefrontSettings> = {
        ...DEFAULT_STOREFRONT_SETTINGS,
        region,
        shipping: { rates: defaultShippingRates(region) },
        checkout: {
          ...DEFAULT_STOREFRONT_SETTINGS.checkout,
          fulfilmentBranchId: branches[0]?.id ?? null,
          deliveryVariantId: await this.ensureDeliveryVariant(tx, tenantId),
        },
        branches: branches.map((b) => ({
          branchId: b.id,
          emirate: region.zones[0]!.code,
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
      const { name, isActive, checkout, theme, region, headless, navigation, ...rest } = dto;

      if (checkout?.fulfilmentBranchId) await this.assertBranch(tx, checkout.fulfilmentBranchId);
      for (const branch of dto.branches ?? []) await this.assertBranch(tx, branch.branchId);

      if (headless?.enabled) await this.assertHeadlessAllowed(tx);

      const next: StorefrontSettings = {
        ...current,
        ...rest,
        theme: theme
          ? {
              ...current.theme,
              ...theme,
              colors: { ...current.theme.colors, ...theme.colors },
              layout: { ...current.theme.layout, ...theme.layout },
              announcement: { ...current.theme.announcement, ...theme.announcement },
              social: theme.social ?? current.theme.social,
            }
          : current.theme,
        navigation: { ...current.navigation, ...navigation },
        region: { ...current.region, ...region },
        headless: { ...current.headless, ...headless },
        checkout: {
          ...current.checkout,
          ...checkout,
          cod: { ...current.checkout.cod, ...checkout?.cod },
          card: { ...current.checkout.card, ...checkout?.card },
          // Not editable here: it must stay the tenant's own non-stock delivery line.
          deliveryVariantId: current.checkout.deliveryVariantId ?? (await this.ensureDeliveryVariant(tx, tenantId)),
        },
      };
      // Only when the request touches them, so an unrelated save (a colour) is
      // never refused over a rate that was already stale.
      if (region?.zones || dto.shipping || dto.branches) {
        assertZonesConsistent(next.region, next.shipping.rates, next.branches);
      }
      await tx
        .update(schema.storefronts)
        .set({ settings: next, ...(name ? { name } : {}), ...(isActive !== undefined ? { isActive } : {}) })
        .where(eq(schema.storefronts.id, storefront.id));
    });
    this.resolver.invalidateTenant(tenantId);
    return this.get();
  }

  /** A custom front end reads the catalogue with the plan's API access, like any other integration. */
  private async assertHeadlessAllowed(tx: Transaction): Promise<void> {
    const tenant = await tx.query.tenants.findFirst({ columns: { planId: true } });
    if (!resolvePlan(tenant?.planId).features.apiAccess) {
      throw new AppError(ERROR_CODES.PLAN_LIMIT_EXCEEDED, "Your plan does not include API access. Upgrade to let a custom front end use your store.");
    }
  }

  async addDomain(dto: DomainDto) {
    const tenantId = RequestContext.requireTenantId();
    this.assertDomainAllowed(dto.domain);
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
  /**
   * Whether `<label>.<base>` can be this store's free address: the same rules
   * a save applies, plus whether another store already has it. Answers rather
   * than throws, so the form can say why as the owner types.
   */
  async subdomainAvailability(rawLabel: string) {
    const label = rawLabel.trim().toLowerCase();
    if (!this.baseDomain) {
      return { label, hostname: null, available: false, reason: "Free shop addresses aren't set up on this platform." };
    }
    const hostname = `${label}.${this.baseDomain}`;
    const problem = subdomainLabelProblem(label);
    if (problem) return { label, hostname, available: false, reason: problem };

    const tenantId = RequestContext.requireTenantId();
    const taken = await this.db.runAsPlatformAdmin((tx) =>
      tx.query.storefrontDomains.findFirst({ where: (t, { eq: e }) => e(t.domain, hostname), columns: { tenantId: true } }),
    );
    if (taken) {
      return {
        label,
        hostname,
        available: false,
        reason: taken.tenantId === tenantId ? "Your store already uses this address." : "That address is taken. Try another name.",
      };
    }
    return { label, hostname, available: true };
  }

  private assertDomainAllowed(domain: string): void {
    const check = checkStorefrontHostname(domain, this.baseDomain);
    if (!check.ok) throw new AppError(ERROR_CODES.VALIDATION_FAILED, check.message);
  }

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

