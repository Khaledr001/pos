import { and, asc, desc, eq, inArray, isNull, ne, schema, sql } from "@devsfleet/db";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { assertBranchInScope } from "../../common/context/branch-scope.js";
import { RequestContext } from "../../common/context/request-context.js";
import { ZERO_MONEY } from "../../common/validation/money.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import type { CreatePurchaseOrderDto } from "../purchases/dto.js";
import { PurchasesService } from "../purchases/purchases.service.js";
import type { CreateDraftOrdersDto } from "./dto.js";
import { chooseSupplier, estimateUnitCost, suggestQuantity } from "./reorder-logic.js";

export interface SuggestionLine {
  variantId: string;
  sku: string;
  productName: string;
  variantName: string;
  unitAbbr: string | null;
  available: string;
  threshold: string;
  reorderQuantity: string;
  incoming: string;
  suggestedQuantity: string;
  /** Already covered by stock on order — shown so nobody wonders, not pre-selected. */
  coveredByIncoming: boolean;
  /** Per base unit, a starting figure to confirm. Null when nothing is known. */
  unitCost: string | null;
  supplierId: string | null;
  /** Every active supplier linked to this item, for switching. */
  suppliers: Array<{ supplierId: string; name: string; lastCost: string | null; leadTimeDays: number | null }>;
}

export interface SuggestionGroup {
  supplierId: string | null;
  supplierName: string | null;
  lines: SuggestionLine[];
}

export interface DraftOrderResult {
  clientId: string;
  supplierId: string;
  ok: boolean;
  purchaseOrderId?: string;
  poNumber?: string;
  error?: string;
  errorCode?: string;
}

/** Open = still able to deliver: a draft about to go, sent, or part-received. */
const OPEN_PO_STATUSES = ["draft", "sent", "partial"] as const;

/** How long a finished draft-order request is remembered for retries. */
const REPLAY_WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class ReorderService {
  /**
   * Replays of POST /reorder/draft-orders, by tenant and the page's clientId.
   *
   * A purchase order has no client-minted id column to upsert on, so the
   * guard against a double-click or a timed-out retry lives here: the second
   * request for a supplier group gets the first request's order back — while
   * it is still being written, too, since the in-flight promise is shared.
   * In memory, so it does not survive an API restart or span several API
   * instances; a `local_id` on purchase_orders would make it durable.
   */
  private readonly replays = new Map<string, { result: Promise<DraftOrderResult>; expiresAt: number }>();

  constructor(
    private readonly db: TenantDatabase,
    private readonly purchases: PurchasesService,
  ) {}

  async suggestions(branchId: string): Promise<{ branchId: string; groups: SuggestionGroup[]; coveredByIncoming: number }> {
    assertBranchInScope(branchId);

    return this.db.run(async (tx) => {
      const pv = schema.productVariants;
      const inv = schema.inventory;

      // A branch's own reorder level wins over the product-wide minimum: the
      // warehouse keeps more cable than the counter does.
      const threshold = sql<string>`(CASE WHEN coalesce(${inv.reorderLevel}, 0) > 0 THEN ${inv.reorderLevel} ELSE ${pv.minStock} END)`;
      const usual = sql<string>`(CASE WHEN coalesce(${inv.reorderQuantity}, 0) > 0 THEN ${inv.reorderQuantity} ELSE ${pv.reorderQuantity} END)`;
      const available = sql<string>`(${inv.quantity} - ${inv.reservedQuantity})`;

      const low = await tx
        .select({
          variantId: pv.id,
          sku: pv.sku,
          variantName: pv.variantName,
          productName: schema.products.name,
          unitAbbr: schema.units.abbreviation,
          allowsFractions: schema.units.allowsFractions,
          available: sql<string>`${available}::text`,
          threshold: sql<string>`${threshold}::text`,
          reorderQuantity: sql<string>`${usual}::text`,
          averageCost: sql<string | null>`${inv.averageCost}::text`,
        })
        .from(pv)
        .innerJoin(schema.products, eq(pv.productId, schema.products.id))
        .leftJoin(schema.units, eq(schema.products.unitId, schema.units.id))
        // INNER: only what this branch carries. `minStock` is set per product
        // for the whole business, and a branch that has never stocked an item
        // has no row for it — suggesting it everywhere turned an 8-line shelf
        // into 297 suggestions. A branch takes on an item by stocking it.
        .innerJoin(inv, and(eq(inv.variantId, pv.id), eq(inv.branchId, branchId)))
        .where(
          and(
            isNull(pv.deletedAt),
            eq(pv.isActive, true),
            isNull(schema.products.deletedAt),
            eq(schema.products.isActive, true),
            sql`${threshold} > 0`,
            sql`${available} <= ${threshold}`,
          ),
        );

      if (low.length === 0) return { branchId, groups: [], coveredByIncoming: 0 };
      const variantIds = low.map((l) => l.variantId);

      const [incomingRows, linkRows, paidRows, listRows] = await Promise.all([
        tx
          .select({
            variantId: schema.purchaseOrderItems.variantId,
            incoming: sql<string>`sum(greatest(${schema.purchaseOrderItems.quantity} * ${schema.purchaseOrderItems.unitConversionFactor} - ${schema.purchaseOrderItems.receivedQuantity}, 0))::numeric(19,4)::text`,
          })
          .from(schema.purchaseOrderItems)
          .innerJoin(schema.purchaseOrders, eq(schema.purchaseOrderItems.purchaseOrderId, schema.purchaseOrders.id))
          .where(
            and(
              eq(schema.purchaseOrders.branchId, branchId),
              inArray(schema.purchaseOrders.status, [...OPEN_PO_STATUSES]),
              inArray(schema.purchaseOrderItems.variantId, variantIds),
            ),
          )
          .groupBy(schema.purchaseOrderItems.variantId),

        tx
          .select({
            variantId: schema.productSupplierLinks.variantId,
            supplierId: schema.productSupplierLinks.supplierId,
            name: schema.suppliers.name,
            lastCost: sql<string | null>`${schema.productSupplierLinks.lastCost}::text`,
            leadTimeDays: schema.productSupplierLinks.leadTimeDays,
            updatedAt: schema.productSupplierLinks.updatedAt,
          })
          .from(schema.productSupplierLinks)
          .innerJoin(schema.suppliers, eq(schema.productSupplierLinks.supplierId, schema.suppliers.id))
          .where(
            and(
              inArray(schema.productSupplierLinks.variantId, variantIds),
              isNull(schema.suppliers.deletedAt),
              eq(schema.suppliers.isActive, true),
            ),
          ),

        // The last price paid each supplier for each item, per BASE unit —
        // a line for 2 boxes of 100 at 340 is 3.40 a piece.
        tx
          .selectDistinctOn([schema.purchaseOrderItems.variantId, schema.purchaseOrders.supplierId], {
            variantId: schema.purchaseOrderItems.variantId,
            supplierId: schema.purchaseOrders.supplierId,
            supplierName: schema.suppliers.name,
            unitCost: sql<string>`(${schema.purchaseOrderItems.unitPrice} / ${schema.purchaseOrderItems.unitConversionFactor})::numeric(19,4)::text`,
            orderedAt: schema.purchaseOrders.createdAt,
          })
          .from(schema.purchaseOrderItems)
          .innerJoin(schema.purchaseOrders, eq(schema.purchaseOrderItems.purchaseOrderId, schema.purchaseOrders.id))
          .innerJoin(schema.suppliers, eq(schema.purchaseOrders.supplierId, schema.suppliers.id))
          .where(
            and(
              inArray(schema.purchaseOrderItems.variantId, variantIds),
              ne(schema.purchaseOrders.status, "cancelled"),
              isNull(schema.suppliers.deletedAt),
              eq(schema.suppliers.isActive, true),
            ),
          )
          .orderBy(
            schema.purchaseOrderItems.variantId,
            schema.purchaseOrders.supplierId,
            desc(schema.purchaseOrders.createdAt),
          ),

        tx
          .selectDistinctOn([schema.productPrices.variantId], {
            variantId: schema.productPrices.variantId,
            purchasePrice: sql<string | null>`${schema.productPrices.purchasePrice}::text`,
          })
          .from(schema.productPrices)
          .innerJoin(schema.priceLists, eq(schema.productPrices.priceListId, schema.priceLists.id))
          .where(
            and(
              inArray(schema.productPrices.variantId, variantIds),
              eq(schema.priceLists.isDefault, true),
              isNull(schema.productPrices.effectiveTo),
            ),
          )
          .orderBy(schema.productPrices.variantId, asc(schema.productPrices.minQuantity)),
      ]);

      const incoming = new Map(incomingRows.map((r) => [r.variantId, r.incoming]));
      const listPrice = new Map(listRows.map((r) => [r.variantId, r.purchasePrice]));
      const linksBy = groupBy(linkRows, (r) => r.variantId);
      const paidBy = groupBy(paidRows, (r) => r.variantId);
      const supplierNames = new Map<string, string>();
      for (const r of linkRows) supplierNames.set(r.supplierId, r.name);
      for (const r of paidRows) supplierNames.set(r.supplierId, r.supplierName);

      const groups = new Map<string | null, SuggestionLine[]>();
      let covered = 0;

      for (const item of low) {
        const links = linksBy.get(item.variantId) ?? [];
        const paid = paidBy.get(item.variantId) ?? [];
        const lastOrder = paid.reduce<(typeof paid)[number] | null>(
          (latest, r) => (!latest || r.orderedAt > latest.orderedAt ? r : latest),
          null,
        );

        const supplierId = chooseSupplier(
          links.map((l) => ({ supplierId: l.supplierId, updatedAt: l.updatedAt })),
          lastOrder?.supplierId ?? null,
        );

        const { quantity, coveredByIncoming } = suggestQuantity({
          available: item.available,
          incoming: incoming.get(item.variantId) ?? "0",
          threshold: item.threshold,
          reorderQuantity: item.reorderQuantity,
          allowsFractions: item.allowsFractions ?? false,
        });
        if (coveredByIncoming) covered += 1;

        const line: SuggestionLine = {
          variantId: item.variantId,
          sku: item.sku,
          productName: item.productName,
          variantName: item.variantName,
          unitAbbr: item.unitAbbr,
          available: item.available,
          threshold: item.threshold,
          reorderQuantity: item.reorderQuantity,
          incoming: incoming.get(item.variantId) ?? "0",
          suggestedQuantity: quantity,
          coveredByIncoming,
          unitCost: estimateUnitCost({
            linkCost: links.find((l) => l.supplierId === supplierId)?.lastCost ?? null,
            lastPaidToSupplier: paid.find((r) => r.supplierId === supplierId)?.unitCost ?? null,
            lastPaid: lastOrder?.unitCost ?? null,
            listPurchasePrice: listPrice.get(item.variantId) ?? null,
            averageCost: item.averageCost,
          }),
          supplierId,
          suppliers: links
            .map((l) => ({ supplierId: l.supplierId, name: l.name, lastCost: l.lastCost, leadTimeDays: l.leadTimeDays }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        };

        const bucket = groups.get(supplierId) ?? [];
        bucket.push(line);
        groups.set(supplierId, bucket);
      }

      const ordered: SuggestionGroup[] = [...groups.entries()]
        .map(([supplierId, lines]) => ({
          supplierId,
          supplierName: supplierId ? (supplierNames.get(supplierId) ?? null) : null,
          // Furthest below its threshold first — what runs out soonest.
          lines: lines.sort((a, b) => shortfall(b) - shortfall(a) || a.sku.localeCompare(b.sku)),
        }))
        .sort((a, b) => {
          if (a.supplierId === null) return 1;
          if (b.supplierId === null) return -1;
          return (a.supplierName ?? "").localeCompare(b.supplierName ?? "");
        });

      return { branchId, groups: ordered, coveredByIncoming: covered };
    });
  }

  /**
   * One draft purchase order per supplier, through PurchasesService so the
   * order is numbered, priced and snapshotted exactly as one raised by hand.
   *
   * Each supplier's order is its own transaction: one supplier refusing (a
   * supplier deactivated since the page loaded, say) must not stop the rest,
   * and the result says which went through so a retry raises only the others.
   */
  async createDraftOrders(dto: CreateDraftOrdersDto): Promise<{ orders: DraftOrderResult[] }> {
    assertBranchInScope(dto.branchId);
    const tenantId = RequestContext.requireTenantId();
    this.sweepReplays();

    const orders: DraftOrderResult[] = [];
    for (const order of dto.orders) {
      const key = `${tenantId}:${order.clientId}`;
      const replay = this.replays.get(key);
      if (replay) {
        orders.push(await replay.result);
        continue;
      }

      const result = this.createOne(dto.branchId, order);
      this.replays.set(key, { result, expiresAt: Date.now() + REPLAY_WINDOW_MS });
      const settled = await result;
      // A failure is not remembered: a retry should try again, not repeat the error.
      if (!settled.ok) this.replays.delete(key);
      orders.push(settled);
    }

    // Nothing went through: answer with the first refusal as an error, so the
    // page does not report success with an empty list.
    const first = orders[0];
    if (first && orders.every((o) => !o.ok)) {
      throw new AppError(
        first.errorCode ?? ERROR_CODES.VALIDATION_FAILED,
        first.error ?? "No purchase order could be created",
      );
    }
    return { orders };
  }

  private async createOne(
    branchId: string,
    order: CreateDraftOrdersDto["orders"][number],
  ): Promise<DraftOrderResult> {
    try {
      const created = (await this.purchases.createOrder({
        branchId,
        supplierId: order.supplierId,
        lines: order.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, unitPrice: l.unitPrice })),
        shippingAmount: ZERO_MONEY,
        notes: "Raised from reorder suggestions.",
      } as CreatePurchaseOrderDto)) as { id: string; poNumber: string };
      return {
        clientId: order.clientId,
        supplierId: order.supplierId,
        ok: true,
        purchaseOrderId: created.id,
        poNumber: created.poNumber,
      };
    } catch (error) {
      return {
        clientId: order.clientId,
        supplierId: order.supplierId,
        ok: false,
        error: error instanceof Error ? error.message : "Could not create this order",
        ...(error instanceof AppError ? { errorCode: error.code } : {}),
      };
    }
  }

  private sweepReplays(): void {
    const now = Date.now();
    for (const [key, entry] of this.replays) if (entry.expiresAt <= now) this.replays.delete(key);
  }
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = out.get(k);
    if (bucket) bucket.push(row);
    else out.set(k, [row]);
  }
  return out;
}

/** For ordering only; the figures themselves never pass through a float. */
function shortfall(line: SuggestionLine): number {
  return Number(line.threshold) - Number(line.available);
}
