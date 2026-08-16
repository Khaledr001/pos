import { and, asc, count, eq, isNull, schema, sql } from "@devsfleet/db";
import type { Category } from "@devsfleet/db";
import { AppError, ERROR_CODES, slugify } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import type { CreateCategoryDto, UpdateCategoryDto } from "./dto.js";

/**
 * The category tree.
 *
 * Stored as adjacency (`parentId`) PLUS a materialised `path` and `depth`.
 * Adjacency alone makes "everything under Plumbing" a recursive CTE on every
 * catalogue filter and every question the WhatsApp bot asks; the materialised
 * path turns it into a prefix scan on an index.
 *
 * The cost is that a move has to rewrite its subtree. That is the right trade:
 * categories are reorganised a handful of times a year and filtered on
 * constantly.
 */
@Injectable()
export class CategoriesService {
  /**
   * Five levels.
   *
   * Not arbitrary — a tree deeper than this stops being navigable at a counter,
   * and the limit is what stops `path` growing without bound.
   */
  private readonly MAX_DEPTH = 5;

  constructor(private readonly db: TenantDatabase) {}

  /** The whole tree. Small enough to send at once; the UI needs it that way. */
  async tree(includeInactive = false): Promise<unknown[]> {
    const rows = await this.db.run(async (tx) =>
      tx
        .select({
          id: schema.categories.id,
          parentId: schema.categories.parentId,
          name: schema.categories.name,
          slug: schema.categories.slug,
          skuPrefix: schema.categories.skuPrefix,
          path: schema.categories.path,
          depth: schema.categories.depth,
          sortOrder: schema.categories.sortOrder,
          isActive: schema.categories.isActive,
          productCount: sql<number>`(
            SELECT count(*)::int FROM products p
            WHERE p.category_id = categories.id AND p.deleted_at IS NULL
          )`,
        })
        .from(schema.categories)
        .where(
          and(
            isNull(schema.categories.deletedAt),
            includeInactive ? undefined : eq(schema.categories.isActive, true),
          ),
        )
        .orderBy(asc(schema.categories.path), asc(schema.categories.sortOrder)),
    );

    // Assembled in one pass. Ordering by path guarantees a parent is seen
    // before its children, so no second lookup is needed.
    const byId = new Map(rows.map((r) => [r.id, { ...r, children: [] as unknown[] }]));
    const roots: unknown[] = [];

    for (const row of rows) {
      const node = byId.get(row.id)!;
      const parent = row.parentId ? byId.get(row.parentId) : null;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }

    return roots;
  }

  async findById(id: string): Promise<Category> {
    const category = await this.db.run(async (tx) =>
      tx.query.categories.findFirst({
        where: (t, { and: a, eq: e, isNull: n }) => a(e(t.id, id), n(t.deletedAt)),
      }),
    );
    if (!category) throw new AppError(ERROR_CODES.NOT_FOUND, `Category ${id} not found`);
    return category;
  }

  async create(dto: CreateCategoryDto): Promise<Category> {
    const tenantId = RequestContext.requireTenantId();

    return this.db.run(async (tx) => {
      const parent = dto.parentId
        ? await tx.query.categories.findFirst({
            where: (t, { and: a, eq: e, isNull: n }) =>
              a(e(t.id, dto.parentId!), n(t.deletedAt)),
          })
        : null;

      if (dto.parentId && !parent) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, "That parent category does not exist");
      }

      const depth = parent ? parent.depth + 1 : 0;
      if (depth >= this.MAX_DEPTH) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          `Categories can nest ${this.MAX_DEPTH} levels deep. This would be level ${depth + 1}.`,
        );
      }

      const slug = slugify(dto.name);
      const path = parent ? `${parent.path}/${slug}` : slug;

      const [category] = await tx
        .insert(schema.categories)
        .values({
          tenantId,
          parentId: dto.parentId ?? null,
          name: dto.name,
          slug,
          path,
          depth,
          skuPrefix: dto.skuPrefix ?? null,
          sortOrder: dto.sortOrder ?? 0,
        })
        .returning();

      if (!category) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not create the category");
      return category;
    });
  }

  /**
   * Update, including moving the category to a new parent.
   *
   * A move rewrites the whole subtree's `path` and `depth` in one statement.
   * Doing it row by row would leave the tree inconsistent if anything failed
   * partway, and a half-moved tree is very hard to reason about afterwards.
   */
  async update(id: string, dto: UpdateCategoryDto): Promise<Category> {
    return this.db.run(async (tx) => {
      const existing = await tx.query.categories.findFirst({
        where: (t, { and: a, eq: e, isNull: n }) => a(e(t.id, id), n(t.deletedAt)),
      });
      if (!existing) throw new AppError(ERROR_CODES.NOT_FOUND, `Category ${id} not found`);

      const moving = dto.parentId !== undefined && dto.parentId !== existing.parentId;
      let newPath = existing.path;
      let newDepth = existing.depth;

      if (moving) {
        if (dto.parentId === id) {
          throw new AppError(
            ERROR_CODES.VALIDATION_FAILED,
            "A category cannot be its own parent",
          );
        }

        const parent = dto.parentId
          ? await tx.query.categories.findFirst({
              where: (t, { and: a, eq: e, isNull: n }) =>
                a(e(t.id, dto.parentId!), n(t.deletedAt)),
            })
          : null;

        if (dto.parentId && !parent) {
          throw new AppError(ERROR_CODES.VALIDATION_FAILED, "That parent category does not exist");
        }

        /**
         * Reject moving a category INTO its own subtree. The path prefix is the
         * cheap test — a descendant's path always starts with its ancestor's —
         * and without it the pair becomes an orphaned cycle that no tree walk
         * can reach.
         */
        if (parent && parent.path.startsWith(`${existing.path}/`)) {
          throw new AppError(
            ERROR_CODES.VALIDATION_FAILED,
            "Cannot move a category inside one of its own subcategories",
          );
        }

        newDepth = parent ? parent.depth + 1 : 0;
        newPath = parent ? `${parent.path}/${existing.slug}` : existing.slug;

        // The deepest descendant must still fit under MAX_DEPTH after the move.
        const [deepest] = await tx
          .select({ maxDepth: sql<number>`coalesce(max(depth), 0)::int` })
          .from(schema.categories)
          .where(sql`path = ${existing.path} OR path LIKE ${`${existing.path}/%`}`);

        const shift = newDepth - existing.depth;
        if ((deepest?.maxDepth ?? 0) + shift >= this.MAX_DEPTH) {
          throw new AppError(
            ERROR_CODES.VALIDATION_FAILED,
            `That move would push subcategories past ${this.MAX_DEPTH} levels`,
          );
        }
      }

      const slug = dto.name ? slugify(dto.name) : existing.slug;
      if (dto.name && slug !== existing.slug) {
        newPath = newPath.replace(/[^/]+$/, slug);
      }

      const [updated] = await tx
        .update(schema.categories)
        .set({
          ...(dto.name !== undefined ? { name: dto.name, slug } : {}),
          ...(dto.skuPrefix !== undefined ? { skuPrefix: dto.skuPrefix } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(moving ? { parentId: dto.parentId ?? null } : {}),
          ...(newPath !== existing.path ? { path: newPath, depth: newDepth } : {}),
        })
        .where(eq(schema.categories.id, id))
        .returning();

      if (!updated) throw new AppError(ERROR_CODES.NOT_FOUND, `Category ${id} not found`);

      /**
       * Rewrite the subtree in one statement: swap the old prefix for the new,
       * and shift depth by the same amount the moved node shifted.
       *
       * The `::int` cast is load-bearing. Postgres overloads `substring`, and a
       * bare parameter arrives as `unknown`, which resolves to
       * `substring(text FROM pattern)` — the REGEX form. A pattern that does
       * not match returns NULL, so the whole subtree's `path` was being set to
       * NULL rather than rewritten. Typing the argument picks the positional
       * overload that was intended.
       */
      if (newPath !== existing.path) {
        await tx.execute(sql`
          UPDATE categories
          SET path  = ${newPath} || substring(path FROM ${existing.path.length + 1}::int),
              depth = depth + ${newDepth - existing.depth}::int
          WHERE path LIKE ${`${existing.path}/%`}
        `);
      }

      return updated;
    });
  }

  /**
   * Soft delete, refused while anything depends on it.
   *
   * Deleting a category that still has products would leave them uncategorised
   * and invisible to every filtered view — which reads as data loss to the
   * person who did it.
   */
  async remove(id: string): Promise<void> {
    await this.db.run(async (tx) => {
      const [children] = await tx
        .select({ value: count() })
        .from(schema.categories)
        .where(
          and(eq(schema.categories.parentId, id), isNull(schema.categories.deletedAt)),
        );

      if ((children?.value ?? 0) > 0) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          `This category has ${children!.value} subcategories. Move or delete them first.`,
        );
      }

      const [products] = await tx
        .select({ value: count() })
        .from(schema.products)
        .where(and(eq(schema.products.categoryId, id), isNull(schema.products.deletedAt)));

      if ((products?.value ?? 0) > 0) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          `${products!.value} products are in this category. Move them first.`,
        );
      }

      const [deleted] = await tx
        .update(schema.categories)
        .set({ deletedAt: new Date(), isActive: false })
        .where(and(eq(schema.categories.id, id), isNull(schema.categories.deletedAt)))
        .returning({ id: schema.categories.id });

      if (!deleted) throw new AppError(ERROR_CODES.NOT_FOUND, `Category ${id} not found`);
    });
  }
}
