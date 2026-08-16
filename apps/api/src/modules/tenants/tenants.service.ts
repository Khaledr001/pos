import { eq, schema, type Tenant } from "@devsfleet/db";
import { resolveTenantSettings, type TenantSettings } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../common/context/request-context.js";
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
   */
  async updateSettings(patch: UpdateTenantSettingsDto): Promise<TenantSettings> {
    const tenantId = RequestContext.requireTenantId();

    return this.db.run(async (tx) => {
      const existing = await tx.query.tenants.findFirst();
      if (!existing) {
        throw new AppError(ERROR_CODES.NOT_FOUND, "Business not found");
      }

      const current = resolveTenantSettings(existing.settings);
      const merged: TenantSettings = {
        ...current,
        ...(patch.legalName !== undefined ? { legalName: patch.legalName } : {}),
        ...(patch.trn !== undefined ? { trn: patch.trn } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
        ...(patch.email !== undefined ? { email: patch.email } : {}),
        ...(patch.logoUrl !== undefined ? { logoUrl: patch.logoUrl } : {}),
        ...(patch.addressLines !== undefined ? { addressLines: patch.addressLines } : {}),
        tax: { ...current.tax, ...patch.tax },
        sales: { ...current.sales, ...patch.sales },
        printing: { ...current.printing, ...patch.printing },
      };

      await tx
        .update(schema.tenants)
        .set({ settings: merged })
        .where(eq(schema.tenants.id, tenantId));

      return merged;
    });
  }
}
