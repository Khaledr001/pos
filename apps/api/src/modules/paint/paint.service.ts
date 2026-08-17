import { and, asc, eq, ilike, isNull, or, schema } from "@devsfleet/db";
import { AppError, ERROR_CODES, Money } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { assertBranchInScope, requireBranchId } from "../../common/context/branch-scope.js";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { StockService } from "../inventory/stock.service.js";
import type {
  CreateFormulaDto,
  CreatePaintOrderDto,
  ListPaintOrdersDto,
  SearchFormulasDto,
  UpdateFormulaDto,
} from "./dto.js";

type Transaction = Parameters<Parameters<TenantDatabase["run"]>[0]>[0];

/**
 * Custom colour mixing.
 *
 * A formula names a base can and the tint dosages that turn it into a named
 * colour. The dosages are informational only — the mixing machine meters tint
 * from bulk canisters that are never tracked as inventory in their own right.
 * What a paint order actually moves is the BASE CAN: one order consumes
 * exactly one base can of the formula's size, the same as any other sale of a
 * stock-tracked product.
 */
@Injectable()
export class PaintService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly stock: StockService,
  ) {}

  async createFormula(dto: CreateFormulaDto): Promise<unknown> {
    const tenantId = RequestContext.requireTenantId();

    return this.db.run(async (tx) => {
      const base = await tx.query.productVariants.findFirst({
        where: (t, { eq: e }) => e(t.id, dto.baseVariantId),
      });
      if (!base) throw new AppError(ERROR_CODES.PRODUCT_NOT_FOUND, "That base variant does not exist");

      const [formula] = await tx
        .insert(schema.paintFormulas)
        .values({
          tenantId,
          colorCode: dto.colorCode,
          colorName: dto.colorName,
          baseVariantId: dto.baseVariantId,
          sizeMl: dto.sizeMl,
          ...(dto.notes ? { notes: dto.notes } : {}),
        })
        .returning();

      if (!formula) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not create the formula");

      if (dto.components.length > 0) {
        await tx.insert(schema.formulaComponents).values(
          dto.components.map((component, index) => ({
            tenantId,
            formulaId: formula.id,
            componentName: component.componentName,
            quantityMl: String(component.quantityMl),
            sortOrder: index,
          })),
        );
      }

      return this.findFormulaById(formula.id, tx);
    });
  }

  /**
   * The whole component list is replaced, not patched.
   *
   * A formula is a handful of dosages, not a document with independent lines
   * — allowing a partial edit invites a machine mixing three tints from the
   * new recipe and two left over from the old one.
   */
  async updateFormula(id: string, dto: UpdateFormulaDto): Promise<unknown> {
    const tenantId = RequestContext.requireTenantId();

    return this.db.run(async (tx) => {
      const existing = await tx.query.paintFormulas.findFirst({
        where: (t, { eq: e }) => e(t.id, id),
      });
      if (!existing) throw new AppError(ERROR_CODES.NOT_FOUND, `Formula ${id} not found`);

      await tx
        .update(schema.paintFormulas)
        .set({
          ...(dto.colorCode !== undefined ? { colorCode: dto.colorCode } : {}),
          ...(dto.colorName !== undefined ? { colorName: dto.colorName } : {}),
          ...(dto.baseVariantId !== undefined ? { baseVariantId: dto.baseVariantId } : {}),
          ...(dto.sizeMl !== undefined ? { sizeMl: dto.sizeMl } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        })
        .where(eq(schema.paintFormulas.id, id));

      if (dto.components) {
        await tx.delete(schema.formulaComponents).where(eq(schema.formulaComponents.formulaId, id));
        if (dto.components.length > 0) {
          await tx.insert(schema.formulaComponents).values(
            dto.components.map((component, index) => ({
              tenantId,
              formulaId: id,
              componentName: component.componentName,
              quantityMl: String(component.quantityMl),
              sortOrder: index,
            })),
          );
        }
      }

      return this.findFormulaById(id, tx);
    });
  }

  async findFormulaById(id: string, existing?: Transaction): Promise<unknown> {
    const read = async (tx: Transaction) => {
      const formula = await tx.query.paintFormulas.findFirst({
        where: (t, { eq: e }) => e(t.id, id),
      });
      if (!formula) throw new AppError(ERROR_CODES.NOT_FOUND, `Formula ${id} not found`);

      const [base, components] = await Promise.all([
        tx.query.productVariants.findFirst({
          where: (t, { eq: e }) => e(t.id, formula.baseVariantId),
          columns: { sku: true, variantName: true },
        }),
        tx
          .select()
          .from(schema.formulaComponents)
          .where(eq(schema.formulaComponents.formulaId, id))
          .orderBy(asc(schema.formulaComponents.sortOrder)),
      ]);

      return { ...formula, baseVariant: base, components };
    };

    return existing ? read(existing) : this.db.run(read);
  }

  /** Partial search on colour code OR name — a customer usually knows only one, approximately. */
  async searchFormulas(query: SearchFormulasDto): Promise<unknown[]> {
    return this.db.run(async (tx) => {
      const term = query.q ? `%${query.q}%` : null;

      return tx
        .select({
          id: schema.paintFormulas.id,
          colorCode: schema.paintFormulas.colorCode,
          colorName: schema.paintFormulas.colorName,
          sizeMl: schema.paintFormulas.sizeMl,
          baseSku: schema.productVariants.sku,
        })
        .from(schema.paintFormulas)
        .innerJoin(
          schema.productVariants,
          eq(schema.paintFormulas.baseVariantId, schema.productVariants.id),
        )
        .where(
          term
            ? or(
                ilike(schema.paintFormulas.colorCode, term),
                ilike(schema.paintFormulas.colorName, term),
              )
            : undefined,
        )
        .orderBy(asc(schema.paintFormulas.colorName))
        .limit(50);
    });
  }

  async deleteFormula(id: string): Promise<void> {
    await this.db.run(async (tx) => {
      const [existing] = await tx
        .delete(schema.paintFormulas)
        .where(eq(schema.paintFormulas.id, id))
        .returning({ id: schema.paintFormulas.id });

      if (!existing) throw new AppError(ERROR_CODES.NOT_FOUND, `Formula ${id} not found`);
      // formula_components cascades; paint_orders keep the row via ON DELETE
      // SET NULL — a mix that was made does not stop having been made just
      // because the recipe was later retired.
    });
  }

  /**
   * Record a mix and consume one base can.
   *
   * The base can is deducted through `StockService.deductStock`, the same
   * choke point every sale uses — a paint order is a sale of the can with
   * extra metadata, not a parallel system with its own rules about stock.
   */
  async createOrder(dto: CreatePaintOrderDto): Promise<unknown> {
    const tenantId = RequestContext.requireTenantId();
    const user = RequestContext.requireUser();
    const branchId = requireBranchId(dto.branchId);

    return this.db.run(async (tx) => {
      const formula = dto.formulaId
        ? await tx.query.paintFormulas.findFirst({
            where: (t, { eq: e }) => e(t.id, dto.formulaId!),
          })
        : null;
      if (dto.formulaId && !formula) {
        throw new AppError(ERROR_CODES.NOT_FOUND, "That formula does not exist");
      }

      if (dto.saleId) {
        const sale = await tx.query.sales.findFirst({
          where: (t, { eq: e }) => e(t.id, dto.saleId!),
          columns: { id: true },
        });
        if (!sale) throw new AppError(ERROR_CODES.NOT_FOUND, "That sale does not exist");
      }

      const [order] = await tx
        .insert(schema.paintOrders)
        .values({
          tenantId,
          branchId,
          ...(formula ? { formulaId: formula.id } : {}),
          ...(dto.saleId ? { saleId: dto.saleId } : {}),
          ...(dto.customNotes ? { customNotes: dto.customNotes } : {}),
          userId: user.id,
        })
        .returning();

      if (!order) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not create the paint order");

      // A fully custom mix with no saved formula has no base can on record to
      // deduct — the tinting machine drew from bulk canisters, not the shelf.
      if (formula) {
        await this.stock.deductStock({
          tx,
          variantId: formula.baseVariantId,
          branchId,
          quantity: "1",
          referenceType: "sale",
          referenceId: order.id,
        });
      }

      return { ...order, formula };
    });
  }

  async listOrders(query: ListPaintOrdersDto): Promise<unknown[]> {
    if (query.branchId) assertBranchInScope(query.branchId);

    return this.db.run(async (tx) =>
      tx
        .select({
          id: schema.paintOrders.id,
          branchId: schema.paintOrders.branchId,
          colorCode: schema.paintFormulas.colorCode,
          colorName: schema.paintFormulas.colorName,
          customNotes: schema.paintOrders.customNotes,
          userName: schema.users.name,
          createdAt: schema.paintOrders.createdAt,
        })
        .from(schema.paintOrders)
        .leftJoin(schema.paintFormulas, eq(schema.paintOrders.formulaId, schema.paintFormulas.id))
        .innerJoin(schema.users, eq(schema.paintOrders.userId, schema.users.id))
        .where(query.branchId ? eq(schema.paintOrders.branchId, query.branchId) : undefined)
        .orderBy(schema.paintOrders.createdAt),
    );
  }
}
