import { and, desc, eq, schema, sql, type Transaction } from "@devsfleet/db";
import { resolvePlan, resolveStorefrontSettings, resolveTenantSettings, trialStatus } from "@devsfleet/shared-types";
import { Injectable } from "@nestjs/common";
import type { StorefrontScope } from "../../../common/context/request-context.js";
import { TenantDatabase } from "../../../database/tenant-database.service.js";

/** A found storefront is cached briefly; an unknown host more briefly still. */
const HIT_TTL_MS = 60_000;
const MISS_TTL_MS = 10_000;
/** Bounds memory against a scan of random Host headers. */
const MAX_ENTRIES = 1_000;

/**
 * Lowercase, no port, no trailing dot. "Shop.Example.ae:443." and
 * "shop.example.ae" are the same storefront.
 */
export function normalizeHost(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const first = raw.split(",")[0]!.trim().toLowerCase();
  // IPv6 literals keep their brackets; everything else drops the port.
  const host = first.startsWith("[") ? first.slice(0, first.indexOf("]") + 1) : first.split(":")[0]!;
  const trimmed = host.replace(/\.$/, "");
  return trimmed.length > 0 && trimmed.length <= 255 ? trimmed : null;
}

/**
 * Host -> storefront -> tenant. The storefront's equivalent of reading the
 * tenant off a JWT.
 *
 * Runs with RLS bypassed because there is no tenant yet to scope by — the
 * same, and only, reason WhatsappService.resolveAccount does. It returns a
 * tenant id and nothing else leaves this method: every later query on the
 * request goes through `db.run()` under that tenant.
 */
@Injectable()
export class StorefrontResolver {
  private readonly cache = new Map<string, { value: StorefrontScope | null; expiresAt: number }>();
  /** Headless CORS answers, keyed "host|origin" and "*|origin" (preflight, no host yet). */
  private readonly headlessCache = new Map<string, { value: boolean; expiresAt: number }>();

  constructor(private readonly db: TenantDatabase) {}

  async resolve(rawHost: string | undefined | null): Promise<StorefrontScope | null> {
    const host = normalizeHost(rawHost);
    if (!host) return null;

    const cached = this.cache.get(host);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const value = await this.load(host);
    if (this.cache.size >= MAX_ENTRIES) this.cache.clear();
    this.cache.set(host, { value, expiresAt: Date.now() + (value ? HIT_TTL_MS : MISS_TTL_MS) });
    return value;
  }

  /**
   * The storefront of a tenant already identified some other way — a payment
   * webhook names its gateway account, a staff member carries their tenant.
   *
   * By default every gate in `load` (plan, suspension, trial) applies, so a
   * webhook for a dark shop finds nothing, exactly as a shopper would.
   * `evenIfDark` is for the tenant's OWN staff: an owner whose plan lapsed
   * still has to be able to cancel and refund the orders already placed.
   */
  async forTenant(tenantId: string, options: { evenIfDark?: boolean } = {}): Promise<StorefrontScope | null> {
    const row = await this.db.runAsPlatformAdmin(async (tx) => {
      const [found] = await this.scopeQuery(tx)
        .leftJoin(schema.storefrontDomains, eq(schema.storefrontDomains.storefrontId, schema.storefronts.id))
        .where(eq(schema.storefronts.tenantId, tenantId))
        .orderBy(desc(schema.storefrontDomains.isPrimary))
        .limit(1);
      return found;
    });
    if (!row) return null;
    return this.toScope(row, row.domain ?? "localhost", options.evenIfDark ?? false);
  }

  /**
   * May a browser page on `origin` call the storefront API for the shop at
   * `rawHost`? True only when that shop has switched headless access on, its
   * plan includes API access, and the origin is on its list. Fails closed.
   */
  async headlessAllows(rawHost: string | undefined | null, origin: string): Promise<boolean> {
    const host = normalizeHost(rawHost);
    if (!host) return false;
    return this.headlessAnswer(`${host}|${origin}`, async () => {
      const rows = await this.db.runAsPlatformAdmin(async (tx) =>
        this.scopeQuery(tx)
          .innerJoin(schema.storefrontDomains, eq(schema.storefrontDomains.storefrontId, schema.storefronts.id))
          .where(eq(schema.storefrontDomains.domain, host))
          .limit(1),
      );
      return rows.some((row) => this.headlessOpen(row, host, origin));
    });
  }

  /**
   * Does ANY shop list this origin? Answers a CORS preflight, which carries no
   * storefront host to look at. It only decides whether the browser may send
   * the real request; the real request is checked again against its own shop.
   */
  async originAllowedAnywhere(origin: string): Promise<boolean> {
    return this.headlessAnswer(`*|${origin}`, async () => {
      const rows = await this.db.runAsPlatformAdmin(async (tx) =>
        this.scopeQuery(tx)
          .innerJoin(schema.storefrontDomains, eq(schema.storefrontDomains.storefrontId, schema.storefronts.id))
          .where(
            and(
              sql`${schema.storefronts.settings} -> 'headless' ->> 'enabled' = 'true'`,
              sql`jsonb_exists(${schema.storefronts.settings} -> 'headless' -> 'allowedOrigins', ${origin})`,
            ),
          )
          .limit(50),
      );
      return rows.some((row) => this.headlessOpen(row, row.domain ?? "localhost", origin));
    });
  }

  private async headlessAnswer(key: string, compute: () => Promise<boolean>): Promise<boolean> {
    const cached = this.headlessCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const value = await compute();
    if (this.headlessCache.size >= MAX_ENTRIES) this.headlessCache.clear();
    this.headlessCache.set(key, { value, expiresAt: Date.now() + (value ? HIT_TTL_MS : MISS_TTL_MS) });
    return value;
  }

  /** The shop is live, headless is on, the plan has API access, and the origin is listed. */
  private headlessOpen(row: ScopeRow, host: string, origin: string): boolean {
    if (!this.toScope(row, host, false)) return false;
    if (!resolvePlan(row.planId).features.apiAccess) return false;
    const { headless } = resolveStorefrontSettings(row.settings);
    return headless.enabled && headless.allowedOrigins.includes(origin);
  }

  /** Drop cached entries for a tenant after its storefront settings or domains change. */
  invalidateTenant(tenantId: string): void {
    // Keyed by host and origin, not tenant, and tiny: clearing all is simpler than indexing.
    this.headlessCache.clear();
    for (const [host, entry] of this.cache) {
      if (!entry.value || entry.value.tenantId === tenantId) this.cache.delete(host);
    }
  }

  private async load(host: string): Promise<StorefrontScope | null> {
    const row = await this.db.runAsPlatformAdmin(async (tx) => {
      const [found] = await this.scopeQuery(tx)
        .innerJoin(schema.storefrontDomains, eq(schema.storefrontDomains.storefrontId, schema.storefronts.id))
        .where(eq(schema.storefrontDomains.domain, host))
        .limit(1);
      return found;
    });
    return row ? this.toScope(row, host, false) : null;
  }

  private scopeQuery(tx: Transaction) {
    return tx
      .select({
        id: schema.storefronts.id,
        tenantId: schema.storefronts.tenantId,
        name: schema.storefronts.name,
        settings: schema.storefronts.settings,
        isActive: schema.storefronts.isActive,
        domain: schema.storefrontDomains.domain,
        tenantName: schema.tenants.name,
        tenantSettings: schema.tenants.settings,
        tenantActive: schema.tenants.isActive,
        tenantDeletedAt: schema.tenants.deletedAt,
        suspendedAt: schema.tenants.suspendedAt,
        planId: schema.tenants.planId,
        trialEndsAt: schema.tenants.trialEndsAt,
      })
      .from(schema.storefronts)
      .innerJoin(schema.tenants, eq(schema.storefronts.tenantId, schema.tenants.id))
      .$dynamic();
  }

  private toScope(row: ScopeRow, host: string, evenIfDark: boolean): StorefrontScope | null {
    if (!evenIfDark) {
      if (!row.isActive || !row.tenantActive || row.tenantDeletedAt || row.suspendedAt) return null;
      // A shop window is a plan feature, and an expired trial sells nothing —
      // the same answer the admin panel gives the owner, given to their customers.
      if (!resolvePlan(row.planId).features.onlineStore) return null;
      if (trialStatus(row.planId, row.trialEndsAt, new Date()).expired) return null;
    }

    const settings = resolveStorefrontSettings(row.settings);
    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      siteUrl: (settings.siteUrl ?? `https://${host}`).replace(/\/+$/, ""),
      settings,
      tenantName: row.tenantName,
      tenantSettings: resolveTenantSettings(row.tenantSettings),
    };
  }
}

interface ScopeRow {
  id: string;
  tenantId: string;
  name: string;
  settings: unknown;
  isActive: boolean;
  domain: string | null;
  tenantName: string;
  tenantSettings: unknown;
  tenantActive: boolean;
  tenantDeletedAt: Date | null;
  suspendedAt: Date | null;
  planId: string;
  trialEndsAt: Date | null;
}
