import { eq, schema, sql, type Tenant } from "@devsfleet/db";
import { resolveTenantSettings, type TenantSettings } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../common/context/request-context.js";
import { checkedLegalAddress } from "../../common/tax/party.js";
import { checkedTaxId } from "../../common/tax/tenant-region.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import type { UpdateTenantSettingsDto } from "./dto.js";

@Injectable()
export class TenantsService {
  constructor(private readonly db: TenantDatabase) {}

  /**
   * The caller's own tenant.
   *
   * RLS makes this safe without a WHERE on the id: the policy on `tenants`
   * compares the primary key to `current_tenant_id()`, so exactly one row is
   * visible and `findFirst` cannot return somebody else's business.
   */
  async current(): Promise<Tenant> {
    const tenant = await this.db.run(async (tx) => tx.query.tenants.findFirst());
    if (!tenant) {
      throw new AppError(ERROR_CODES.NOT_FOUND, "Business not found");
    }
    return tenant;
  }

  /**
   * Merge a partial settings patch over what is stored.
   *
   * Deep-merged per section rather than replaced wholesale: the settings blob
   * holds tax, printing, locale and sales policy together, and a PATCH that
   * only touches the tax rate must not silently reset the receipt footer.
   *
   * Written as a top-level jsonb MERGE of just the keys this request changed,
   * never `settings = <whole object>`: other parts of the platform own their
   * own blocks (the e-invoicing connection's settings), and writing back a
   * copy read earlier in this request would overwrite theirs with a stale one.
   * This endpoint cannot even name `einvoice` — the schema drops it.
   */
  async updateSettings(patch: UpdateTenantSettingsDto): Promise<TenantSettings> {
    const tenantId = RequestContext.requireTenantId();

    return this.db.run(async (tx) => {
      const existing = await tx.query.tenants.findFirst();
      if (!existing) {
        throw new AppError(ERROR_CODES.NOT_FOUND, "Business not found");
      }

      const current = resolveTenantSettings(existing.settings);

      // Only a NEW value is checked: a TRN typed before TRNs were validated
      // stays as it is until somebody edits it.
      const trn = patch.trn !== undefined ? (checkedTaxId(patch.trn, current, "trn") ?? "") : undefined;
      const legalAddress = patch.legalAddress ? checkedLegalAddress(patch.legalAddress) : undefined;

      const delta: Partial<TenantSettings> = {
        ...(patch.legalName !== undefined ? { legalName: patch.legalName } : {}),
        ...(trn !== undefined ? { trn } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
        ...(patch.email !== undefined ? { email: patch.email } : {}),
        ...(patch.logoUrl !== undefined ? { logoUrl: patch.logoUrl } : {}),
        ...(patch.addressLines !== undefined ? { addressLines: patch.addressLines } : {}),
        ...(legalAddress ? { legalAddress } : {}),
        ...(patch.tax ? { tax: { ...current.tax, ...patch.tax } } : {}),
        ...(patch.sales ? { sales: { ...current.sales, ...patch.sales } } : {}),
        ...(patch.printing ? { printing: { ...current.printing, ...patch.printing } } : {}),
      };

      if (Object.keys(delta).length > 0) {
        await tx
          .update(schema.tenants)
          .set({ settings: sql`coalesce(${schema.tenants.settings}, '{}'::jsonb) || ${JSON.stringify(delta)}::jsonb` })
          .where(eq(schema.tenants.id, tenantId));
      }

      return { ...current, ...delta };
    });
  }
}
