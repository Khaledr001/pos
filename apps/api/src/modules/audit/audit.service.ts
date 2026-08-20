import { and, count, desc, eq, gte, lte, schema } from "@devsfleet/db";
import { Injectable } from "@nestjs/common";
import { assertBranchInScope } from "../../common/context/branch-scope.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import type { ListAuditLogDto } from "./dto.js";

/**
 * Read side of the audit trail. `AuditInterceptor` is the only writer — this
 * only ever selects.
 *
 * `changes` and `reason` are always null: the interceptor writing this table
 * only ever records who did what to which entity and when, not a field-level
 * diff. Showing a column for either would promise something the trail does
 * not actually keep.
 */
@Injectable()
export class AuditService {
  constructor(private readonly db: TenantDatabase) {}

  async list(query: ListAuditLogDto): Promise<{ items: unknown[]; total: number }> {
    if (query.branchId) assertBranchInScope(query.branchId);

    return this.db.run(async (tx) => {
      const where = and(
        query.branchId ? eq(schema.auditLog.branchId, query.branchId) : undefined,
        query.userId ? eq(schema.auditLog.userId, query.userId) : undefined,
        query.entityType ? eq(schema.auditLog.entityType, query.entityType) : undefined,
        query.from ? gte(schema.auditLog.createdAt, new Date(`${query.from}T00:00:00Z`)) : undefined,
        query.to ? lte(schema.auditLog.createdAt, new Date(`${query.to}T23:59:59.999Z`)) : undefined,
      );

      const [total] = await tx.select({ value: count() }).from(schema.auditLog).where(where);

      const items = await tx
        .select({
          id: schema.auditLog.id,
          entityType: schema.auditLog.entityType,
          entityId: schema.auditLog.entityId,
          action: schema.auditLog.action,
          userName: schema.users.name,
          branchName: schema.branches.name,
          ipAddress: schema.auditLog.ipAddress,
          requestId: schema.auditLog.requestId,
          createdAt: schema.auditLog.createdAt,
        })
        .from(schema.auditLog)
        .leftJoin(schema.users, eq(schema.auditLog.userId, schema.users.id))
        .leftJoin(schema.branches, eq(schema.auditLog.branchId, schema.branches.id))
        .where(where)
        .orderBy(desc(schema.auditLog.createdAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);

      return { items, total: total?.value ?? 0 };
    });
  }

  /** Distinct entity types seen so far — feeds the filter dropdown. */
  async entityTypes(): Promise<string[]> {
    return this.db.run(async (tx) => {
      const rows = await tx
        .selectDistinct({ entityType: schema.auditLog.entityType })
        .from(schema.auditLog)
        .orderBy(schema.auditLog.entityType);
      return rows.map((r) => r.entityType);
    });
  }
}
