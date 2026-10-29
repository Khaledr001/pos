import { eq, isNull, schema, sql } from "@devsfleet/db";
import {
  normalizeTrn,
  UAE_SUBDIVISIONS,
  resolveEinvoiceSettings,
  resolveTenantSettings,
  type EinvoiceProviderView,
  type EinvoiceReadiness,
  type EinvoiceSettings,
  type EinvoiceSettingsView,
} from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { SecretBoxService } from "../../common/crypto/secret-box.service.js";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { ProviderResolver } from "./provider-resolver.js";
import { TRN_PATTERN } from "./pint-ae/constants.js";
import { assessReadiness } from "./readiness.js";
import type { UpdateEinvoiceSettingsDto, UpdateProviderDto } from "./dto.js";
import { assertSafeUrl, UnsafeUrlError } from "./providers/ssrf.js";

/** The business's e-invoicing configuration: switches, identity, provider, and a readiness report. */
@Injectable()
export class EinvoiceSettingsService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly secrets: SecretBoxService,
    private readonly providers: ProviderResolver,
  ) {}

  async view(): Promise<EinvoiceSettingsView> {
    return this.db.run(async (tx) => {
      const { settings } = await this.tenant(tx);
      return { settings: settings.einvoice, provider: await this.providerView(tx), readiness: await this.readiness(tx) };
    });
  }

  async readinessReport(): Promise<EinvoiceReadiness> {
    return this.db.run((tx) => this.readiness(tx));
  }

  async update(dto: UpdateEinvoiceSettingsDto): Promise<EinvoiceSettingsView> {
    const tenantId = RequestContext.requireTenantId();
    await this.db.run(async (tx) => {
      const { raw, settings } = await this.tenant(tx);
      const next: EinvoiceSettings = resolveEinvoiceSettings({
        ...settings.einvoice,
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.mode !== undefined ? { mode: dto.mode } : {}),
        ...(dto.startDate !== undefined ? { startDate: dto.startDate } : {}),
        ...(dto.autoSubmit !== undefined ? { autoSubmit: dto.autoSubmit } : {}),
        ...(dto.endpoint !== undefined ? { endpoint: dto.endpoint } : {}),
        ...(dto.legalRegistration !== undefined ? { legalRegistration: dto.legalRegistration } : {}),
      });

      // Going live is the commitment: the identity a real invoice carries must be there. Sandbox rehearsal is not held to it — it exists to show what is missing.
      if (next.enabled && next.mode === "live") {
        const missing: string[] = [];
        const trn = settings.trn ? normalizeTrn(settings.trn) : "";
        if (!TRN_PATTERN.test(trn)) missing.push("a valid business TRN (15 digits, starting 1 and ending 03)");
        const a = settings.legalAddress;
        if (!a || !a.line1?.trim() || !a.city?.trim() || !(UAE_SUBDIVISIONS as readonly string[]).includes(a.subdivision?.trim() ?? "")) missing.push("a business address with street, city and emirate");
        if (!next.legalRegistration) missing.push("the trade licence");
        const account = await tx.query.einvoiceAccounts.findFirst();
        if (!account || account.provider === "sandbox" || !account.credentialsEnc || !account.endpointUrl) missing.push("a connected e-invoicing provider");
        if (missing.length > 0) throw new AppError(ERROR_CODES.VALIDATION_FAILED, `Live e-invoicing needs ${missing.join("; ")}.`);
      }

      // Only the einvoice block changes; every other setting is left exactly as stored.
      await tx.update(schema.tenants).set({ settings: { ...raw, einvoice: next } }).where(eq(schema.tenants.id, tenantId));
    });
    return this.view();
  }

  async updateProvider(dto: UpdateProviderDto): Promise<EinvoiceProviderView> {
    const tenantId = RequestContext.requireTenantId();
    if (dto.provider === "gateway") {
      if (!dto.endpointUrl) throw new AppError(ERROR_CODES.VALIDATION_FAILED, "A gateway provider needs an endpoint URL.");
      try {
        // Same rule the connection itself applies; refusing at save time just gives the earlier, clearer message.
        assertSafeUrl(dto.endpointUrl, this.providers.allowsPrivate);
      } catch (error) {
        if (error instanceof UnsafeUrlError) throw new AppError(ERROR_CODES.VALIDATION_FAILED, `${error.message}.`);
        throw error;
      }
    }
    // Encrypt BEFORE opening a transaction: a missing key must fail without touching the row.
    const encrypted = dto.credentials !== undefined ? this.secrets.encrypt(dto.credentials) : undefined;

    await this.db.run(async (tx) => {
      const existing = await tx.query.einvoiceAccounts.findFirst();
      if (dto.provider === "gateway" && !encrypted && !existing?.credentialsEnc) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, "A gateway provider needs credentials.");
      }
      const values = {
        provider: dto.provider,
        endpointUrl: dto.provider === "gateway" ? dto.endpointUrl! : null,
        isActive: true,
        ...(encrypted !== undefined ? { credentialsEnc: encrypted } : {}),
        // Switching back to sandbox forgets the stored secret: nothing keeps a key it no longer uses.
        ...(dto.provider === "sandbox" ? { credentialsEnc: null } : {}),
        // Credentials or endpoint changed: the last test no longer describes this connection.
        lastTestAt: null,
        lastTestOk: null,
      };
      if (existing) await tx.update(schema.einvoiceAccounts).set(values).where(eq(schema.einvoiceAccounts.id, existing.id));
      else await tx.insert(schema.einvoiceAccounts).values({ tenantId, ...values });
    });
    return this.db.run(async (tx) => (await this.providerView(tx))!);
  }

  /** Calls the configured provider with a harmless ping and records the answer. */
  async testProvider(): Promise<{ ok: boolean; message: string }> {
    return this.db.run(async (tx) => {
      const { settings } = await this.tenant(tx);
      const resolved = await this.providers.resolve(tx, { ...settings.einvoice, mode: "sandbox" });
      if (!resolved.ok) return { ok: false, message: resolved.message };
      const result = await resolved.provider.testConnection();
      const account = await tx.query.einvoiceAccounts.findFirst();
      if (account) await tx.update(schema.einvoiceAccounts).set({ lastTestAt: new Date(), lastTestOk: result.ok }).where(eq(schema.einvoiceAccounts.id, account.id));
      return result;
    });
  }

  private async tenant(tx: Parameters<Parameters<TenantDatabase["run"]>[0]>[0]) {
    const tenant = await tx.query.tenants.findFirst({ columns: { settings: true } });
    if (!tenant) throw new AppError(ERROR_CODES.NOT_FOUND, "Business not found");
    return { raw: (tenant.settings ?? {}) as Record<string, unknown>, settings: resolveTenantSettings(tenant.settings) };
  }

  private async providerView(tx: Parameters<Parameters<TenantDatabase["run"]>[0]>[0]): Promise<EinvoiceProviderView | null> {
    const account = await tx.query.einvoiceAccounts.findFirst();
    if (!account) return null;
    return {
      provider: account.provider,
      endpointUrl: account.endpointUrl,
      hasCredentials: !!account.credentialsEnc,
      callbackPath: `/api/v1/einvoice/callback/${account.callbackToken}`,
      lastTestAt: account.lastTestAt?.toISOString() ?? null,
      lastTestOk: account.lastTestOk,
    };
  }

  private async readiness(tx: Parameters<Parameters<TenantDatabase["run"]>[0]>[0]): Promise<EinvoiceReadiness> {
    const { settings } = await this.tenant(tx);
    const account = await tx.query.einvoiceAccounts.findFirst();
    const customers = await tx
      .select({
        id: schema.customers.id,
        name: schema.customers.name,
        company: schema.customers.company,
        trn: schema.customers.trn,
        addressLine1: schema.customers.addressLine1,
        addressCity: schema.customers.addressCity,
        addressSubdivision: schema.customers.addressSubdivision,
        addressCountry: schema.customers.addressCountry,
      })
      .from(schema.customers)
      .where(sql`${schema.customers.trn} IS NOT NULL AND btrim(${schema.customers.trn}) <> '' AND ${isNull(schema.customers.deletedAt)}`)
      .orderBy(schema.customers.name)
      .limit(1000);
    return assessReadiness({
      settings,
      provider: account ? { kind: account.provider, hasCredentials: !!account.credentialsEnc, hasEndpoint: !!account.endpointUrl } : null,
      encryptionAvailable: this.secrets.available,
      customers,
    });
  }
}

