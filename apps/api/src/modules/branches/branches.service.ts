import { and, asc, count, desc, eq, ilike, isNull, or, schema } from "@devsfleet/db";
import type { Branch } from "@devsfleet/db";
import type { Paginated } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../common/context/request-context.js";
import { PlanLimitService } from "../../common/guards/plan-limit.service.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import type { CreateBranchDto, ListBranchesDto, UpdateBranchDto } from "./dto.js";

/**
 * REFERENCE MODULE — service
 *
 * Points worth copying:
 *
 *  1. Every query goes through `this.db.run(...)`. No `tenantId` appears in a
 *     WHERE clause anywhere below — row-level security applies it. That is the
 *     whole reason the tenant context exists: a filter you have to remember is
 *     a filter you will eventually forget, and forgetting it here leaks another
 *     business's data.
 *
 *  2. Business failures are `AppError` with a code from ERROR_CODES, not
 *     `NotFoundException`. The exception filter maps codes to HTTP; keeping
 *     services free of HTTP types means the same service can be called from a
 *     queue worker or the WhatsApp bot.
 *
 *  3. Deletes are soft. Documents reference branches for years.
 */
@Injectable()
export class BranchesService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly planLimits: PlanLimitService,
  ) {}

  async list(query: ListBranchesDto): Promise<Paginated<Branch>> {
    const { page, limit, q, includeInactive, sortBy, sortOrder } = query;
    const offset = (page - 1) * limit;

    const where = and(
      isNull(schema.branches.deletedAt),
      includeInactive ? undefined : eq(schema.branches.isActive, true),
      q
        ? or(
            ilike(schema.branches.name, `%${q}%`),
            ilike(schema.branches.code, `%${q}%`),
          )
        : undefined,
    );

    const column = {
      name: schema.branches.name,
      code: schema.branches.code,
      createdAt: schema.branches.createdAt,
    }[sortBy];

    return this.db.run(async (tx) => {
      const [items, [totals]] = await Promise.all([
        tx
          .select()
          .from(schema.branches)
          .where(where)
          .orderBy(sortOrder === "asc" ? asc(column) : desc(column))
          .limit(limit)
          .offset(offset),
        tx.select({ value: count() }).from(schema.branches).where(where),
      ]);

      const total = totals?.value ?? 0;
      const totalPages = Math.max(1, Math.ceil(total / limit));

      return {
        items,
        meta: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };
    });
  }

  async findById(id: string): Promise<Branch> {
    const branch = await this.db.run(async (tx) =>
      tx.query.branches.findFirst({
        where: (t, { and: a, eq: e, isNull: n }) => a(e(t.id, id), n(t.deletedAt)),
      }),
    );

    if (!branch) {
      throw new AppError(ERROR_CODES.NOT_FOUND, `Branch ${id} not found`);
    }
    return branch;
  }

  async create(dto: CreateBranchDto): Promise<Branch> {
    // Both checks before any write. A tenant past its trial or at its branch
    // cap must be refused with a message naming the reason, not left to
    // discover it from a constraint violation.
    this.planLimits.assertTrialActive();
    await this.planLimits.assertCanCreate("branches");

    const tenantId = RequestContext.requireTenantId();

    return this.db.run(async (tx) => {
      const [branch] = await tx
        .insert(schema.branches)
        .values({ tenantId, ...dto })
        .returning();

      if (!branch) {
        throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Failed to create branch");
      }
      return branch;
    });
    // A duplicate code raises 23505 on uq_branches_tenant_code, which
    // AllExceptionsFilter turns into a 409. No pre-flight SELECT: checking
    // first is a race, the unique index is not.
  }

  async update(id: string, dto: UpdateBranchDto): Promise<Branch> {
    if (Object.keys(dto).length === 0) return this.findById(id);

    return this.db.run(async (tx) => {
      const [branch] = await tx
        .update(schema.branches)
        .set(dto)
        .where(and(eq(schema.branches.id, id), isNull(schema.branches.deletedAt)))
        .returning();

      if (!branch) {
        throw new AppError(ERROR_CODES.NOT_FOUND, `Branch ${id} not found`);
      }
      return branch;
    });
  }

  /**
   * Soft delete.
   *
   * Refused while stock remains, because a branch with inventory has value
   * sitting in it — transfer it out first, or the stock silently disappears
   * from every report while still physically on a shelf.
   */
  async remove(id: string): Promise<void> {
    await this.db.run(async (tx) => {
      const [stock] = await tx
        .select({ value: count() })
        .from(schema.inventory)
        .where(
          and(
            eq(schema.inventory.branchId, id),
            // Any non-zero balance, positive or negative.
            eq(schema.inventory.quantity, "0"),
          ),
        );

      const [total] = await tx
        .select({ value: count() })
        .from(schema.inventory)
        .where(eq(schema.inventory.branchId, id));

      const withStock = (total?.value ?? 0) - (stock?.value ?? 0);
      if (withStock > 0) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          `Branch still holds stock in ${withStock} product(s). Transfer it out first.`,
        );
      }

      const [branch] = await tx
        .update(schema.branches)
        .set({ deletedAt: new Date(), isActive: false })
        .where(and(eq(schema.branches.id, id), isNull(schema.branches.deletedAt)))
        .returning({ id: schema.branches.id });

      if (!branch) {
        throw new AppError(ERROR_CODES.NOT_FOUND, `Branch ${id} not found`);
      }
    });
  }
}
