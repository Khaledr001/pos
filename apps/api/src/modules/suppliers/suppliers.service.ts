import { and, asc, count, desc, eq, ilike, isNull, or, schema } from "@devsfleet/db";
import type { Supplier } from "@devsfleet/db";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../common/context/request-context.js";
import { partySettings } from "../../common/tax/party.js";
import { checkedTaxId } from "../../common/tax/tenant-region.js";
import { containsPattern } from "../../common/db/list-query.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import type { CreateSupplierDto, ListSuppliersDto, UpdateSupplierDto } from "./dto.js";

/**
 * Suppliers.
 *
 * `outstandingBalance` is what we owe them — the mirror of a customer's credit
 * balance, in the opposite direction. It is moved by goods receipts and
 * payments, never edited directly, so the figure always has documents behind it.
 */
@Injectable()
export class SuppliersService {
  constructor(private readonly db: TenantDatabase) {}

  async create(dto: CreateSupplierDto): Promise<Supplier> {
    const tenantId = RequestContext.requireTenantId();

    return this.db.run(async (tx) => {
      const trn = await this.checkedTrn(tx, dto.trn);
      const [supplier] = await tx
        .insert(schema.suppliers)
        .values({ tenantId, ...dto, ...(trn !== undefined ? { trn } : {}) })
        .returning();

      if (!supplier) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not create the supplier");
      return supplier;
    });
  }

  async update(id: string, dto: UpdateSupplierDto): Promise<Supplier> {
    return this.db.run(async (tx) => {
      // Only a request that names the TRN is checked, so an old, unchecked one
      // never blocks an unrelated edit.
      const trn = await this.checkedTrn(tx, dto.trn);
      const [updated] = await tx
        .update(schema.suppliers)
        .set({ ...dto, ...(trn !== undefined ? { trn } : {}) })
        .where(and(eq(schema.suppliers.id, id), isNull(schema.suppliers.deletedAt)))
        .returning();

      if (!updated) throw new AppError(ERROR_CODES.NOT_FOUND, `Supplier ${id} not found`);
      return updated;
    });
  }

  /** The TRN as it will be stored (`undefined` = not part of this write, `null` = cleared). */
  private async checkedTrn(tx: Parameters<Parameters<TenantDatabase["run"]>[0]>[0], trn: string | undefined) {
    if (trn === undefined) return undefined;
    const tenant = await tx.query.tenants.findFirst({ columns: { settings: true } });
    return checkedTaxId(trn, partySettings(tenant?.settings), "trn");
  }

  async findById(id: string): Promise<Supplier> {
    const supplier = await this.db.run(async (tx) =>
      tx.query.suppliers.findFirst({
        where: (t, { and: a, eq: e, isNull: n }) => a(e(t.id, id), n(t.deletedAt)),
      }),
    );
    if (!supplier) throw new AppError(ERROR_CODES.NOT_FOUND, `Supplier ${id} not found`);
    return supplier;
  }

  async list(query: ListSuppliersDto): Promise<{ items: Supplier[]; total: number }> {
    return this.db.run(async (tx) => {
      const term = containsPattern(query.q);
      const where = and(
        isNull(schema.suppliers.deletedAt),
        query.includeInactive ? undefined : eq(schema.suppliers.isActive, true),
        term
          ? or(
              ilike(schema.suppliers.name, term),
              ilike(schema.suppliers.company, term),
              ilike(schema.suppliers.phone, term),
              ilike(schema.suppliers.trn, term),
            )
          : undefined,
      );

      const [total] = await tx.select({ value: count() }).from(schema.suppliers).where(where);
      const items = await tx
        .select()
        .from(schema.suppliers)
        .where(where)
        .orderBy(
          query.sortOrder === "asc"
            ? asc(schema.suppliers[query.sortBy])
            : desc(schema.suppliers[query.sortBy]),
          desc(schema.suppliers.id),
        )
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);

      return { items, total: total?.value ?? 0 };
    });
  }

  /**
   * Soft delete, refused while purchase orders reference them.
   *
   * A hard delete would break every historical PO's supplier name, and those
   * documents are what a VAT audit asks for.
   */
  async remove(id: string): Promise<void> {
    await this.db.run(async (tx) => {
      const [orders] = await tx
        .select({ value: count() })
        .from(schema.purchaseOrders)
        .where(eq(schema.purchaseOrders.supplierId, id));

      if ((orders?.value ?? 0) > 0) {
        // Deactivating keeps history intact and takes them off every picker,
        // which is what "delete" actually means to the person clicking it.
        await tx
          .update(schema.suppliers)
          .set({ isActive: false, deletedAt: new Date() })
          .where(eq(schema.suppliers.id, id));
        return;
      }

      const [deleted] = await tx
        .update(schema.suppliers)
        .set({ deletedAt: new Date(), isActive: false })
        .where(and(eq(schema.suppliers.id, id), isNull(schema.suppliers.deletedAt)))
        .returning({ id: schema.suppliers.id });

      if (!deleted) throw new AppError(ERROR_CODES.NOT_FOUND, `Supplier ${id} not found`);
    });
  }
}
