import { and, desc, eq, inArray, schema, sql } from "@devsfleet/db";
import {
  hasPermission,
  resolveTenantSettings,
  type PaymentMethod,
} from "@devsfleet/shared-types";
import {
  AppError,
  ERROR_CODES,
  Money,
  calculateDocument,
  formatDocumentNumber,
  sequenceKey,
} from "@devsfleet/shared-utils";
import { Injectable, Logger } from "@nestjs/common";
import { assertBranchInScope, branchScope } from "../../common/context/branch-scope.js";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { StockService } from "../inventory/stock.service.js";
import { PriceResolverService } from "../pricing/price-resolver.service.js";
import { OverrideGrantsService } from "../auth/override-grants.service.js";
import { SerialsService } from "../serials/serials.service.js";
import type { CreateSaleDto } from "./dto.js";

/**
 * Creating a sale — the most consequential write in the system.
 *
 * One transaction covers the sale, its lines, its payments, the stock ledger
 * and the customer's balance. Any of those succeeding without the others
 * produces a business that cannot be reconciled: stock gone with no invoice,
 * or an invoice for stock that never left.
 *
 * The order of the checks below is deliberate. Everything that can refuse the
 * sale runs BEFORE anything is written, so a rejection leaves no trace and no
 * half-applied movement.
 */
@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    private readonly db: TenantDatabase,
    private readonly stock: StockService,
    private readonly prices: PriceResolverService,
    private readonly serials: SerialsService,
    private readonly grants: OverrideGrantsService,
  ) {}

  async create(dto: CreateSaleDto): Promise<unknown> {
    const tenantId = RequestContext.requireTenantId();
    const user = RequestContext.requireUser();

    /**
     * The branch comes from the body, so it has to be checked against the
     * caller's scope. Without this a cashier at one shop could book a sale —
     * and the stock deduction that goes with it — against another shop's
     * inventory, which reads afterwards as shrinkage at a branch they never
     * visited.
     */
    assertBranchInScope(dto.branchId);

    /**
     * Approvals given at the counter, verified before anything is decided.
     *
     * Done outside the transaction: it is signature checking, not a query, and
     * a forged or expired grant simply contributes nothing rather than failing
     * the sale — the refusal the cashier then gets is the same one they would
     * have got without an approval, which is the honest message.
     */
    const approvals = await this.grants.verify(dto.overrideGrants);
    const effectivePermissions = OverrideGrantsService.permissionsWith(
      user.permissions,
      approvals,
    );

    return this.db.run(async (tx) => {
      /**
       * IDEMPOTENCY, first.
       *
       * The POS mints `localId` when the sale is rung up and resends it on
       * every push attempt. A terminal that times out and retries must not
       * create a second invoice — so a known id returns the original sale
       * rather than making another.
       */
      if (dto.localId) {
        const existing = await tx.query.sales.findFirst({
          where: (t, { eq: e }) => e(t.localId, dto.localId!),
        });
        if (existing) {
          this.logger.log({ localId: dto.localId }, "Duplicate push — returning the original");
          return this.findById(existing.id, tx);
        }
      }

      const tenant = await tx.query.tenants.findFirst();
      const settings = resolveTenantSettings(tenant?.settings);

      // --- resolve prices -------------------------------------------------
      const resolved = await this.prices.resolveMany(tx, {
        variantIds: dto.lines.map((l) => l.variantId),
        customerId: dto.customerId ?? null,
        includeCost: true, // snapshotted onto the line, never returned to a cashier
      });
      const priceBy = new Map(resolved.map((p) => [p.variantId, p]));

      const variants = await tx
        .select({
          id: schema.productVariants.id,
          sku: schema.productVariants.sku,
          variantName: schema.productVariants.variantName,
          productName: schema.products.name,
          taxRate: schema.products.taxRate,
          isStockTracked: schema.products.isStockTracked,
          trackSerial: schema.products.trackSerial,
        })
        .from(schema.productVariants)
        .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
        .where(
          sql`${schema.productVariants.id} = ANY(${sql.raw(
            `ARRAY['${dto.lines.map((l) => l.variantId).join("','")}']::uuid[]`,
          )})`,
        );
      const variantBy = new Map(variants.map((v) => [v.id, v]));

      // --- validate every line before writing anything --------------------
      const canOverrideFloor = hasPermission(effectivePermissions, "price:override_floor");
      const canOverridePrice = hasPermission(effectivePermissions, "price:override");

      // A manager approving a discount lends their own ceiling to this sale.
      // Granting `sale:discount` while leaving the cashier's 0% cap in place
      // would authorise precisely nothing.
      const discountCeiling = OverrideGrantsService.discountCeiling(
        user.abac.maxDiscountPercent,
        approvals,
        "sale:discount",
      );
      const maxDiscount = Money.toMinor(discountCeiling);

      const lines = dto.lines.map((line) => {
        const variant = variantBy.get(line.variantId);
        if (!variant) {
          throw new AppError(
            ERROR_CODES.PRODUCT_NOT_FOUND,
            `Variant ${line.variantId} does not exist`,
          );
        }

        const price = priceBy.get(line.variantId);
        // An explicit unit price is an override; otherwise the ladder decides.
        const unitPrice = line.unitPrice ?? price?.unitPrice;
        if (!unitPrice) {
          throw new AppError(
            ERROR_CODES.NO_PRICE_FOR_PRODUCT,
            `${variant.productName} has no price. Set one before selling it.`,
          );
        }

        /**
         * `price:override` was declared and never enforced.
         *
         * Every POS line carries a `unitPrice` and the server simply took it.
         * The floor check was all that stood behind it, so on the many products
         * with no `minSellingPrice` set — the default — a cashier could type any
         * figure and the sale was accepted at it. It does not even read as a
         * discount afterwards: the line looks like list price, because it
         * became list price.
         *
         * Only a price BELOW the resolved one is refused, and that asymmetry is
         * deliberate. A terminal that has been offline since before a price
         * change pushes the figure it last synced, and the server cannot tell
         * that apart from a cashier typing it. Refusing the cheaper direction
         * catches what costs the business money; refusing the dearer direction
         * would reject honest sales rung up on a stale price list, hours after
         * the receipt was printed and the goods handed over.
         *
         * A product the ladder cannot price at all is a different case: naming
         * a price for it IS the override, whichever direction it goes.
         */
        if (line.unitPrice !== undefined && !canOverridePrice) {
          const listed = price?.unitPrice;
          const undercut =
            !listed || Money.toMinor(line.unitPrice) < Money.toMinor(listed);

          if (undercut) {
            throw new AppError(
              ERROR_CODES.INSUFFICIENT_PERMISSIONS,
              listed
                ? `${variant.productName} is priced at ${listed}. Selling it for less needs a manager's approval.`
                : `${variant.productName} has no set price. Pricing it needs a manager's approval.`,
              { line: variant.sku, requested: line.unitPrice, listed: listed ?? null },
            );
          }
        }

        const discountPercent = String(line.discountPercent ?? 0);

        /**
         * ABAC: the discount ceiling.
         *
         * Re-checked here even though the POS greys out the control, because
         * the POS is a client and a client can be modified. A hidden button is
         * a courtesy; this is the control.
         */
        if (Money.toMinor(discountPercent) > maxDiscount) {
          throw new AppError(
            ERROR_CODES.DISCOUNT_EXCEEDS_LIMIT,
            `You may discount up to ${discountCeiling}%. This line is ${discountPercent}%.`,
            { line: variant.sku, requested: discountPercent, allowed: discountCeiling },
          );
        }

        // The floor is checked on the price AFTER discount — a 20% discount
        // off list lands in the same place as typing the discounted figure.
        const floor = this.prices.checkFloor({
          unitPrice,
          discountPercent,
          minSellingPrice: price?.minSellingPrice ?? null,
          canOverrideFloor,
        });
        if (!floor.allowed) {
          throw new AppError(
            ERROR_CODES.BELOW_FLOOR_PRICE,
            `${variant.productName} cannot be sold below ${floor.floor}. A manager must approve this.`,
            { line: variant.sku, effective: floor.effectivePrice, floor: floor.floor },
          );
        }

        /**
         * A serialised product is sold one identified unit at a time — there
         * is no such thing as half an imei, and no such thing as an anonymous
         * one either. Checked here, before any stock moves, so a missing
         * serial refuses the whole sale rather than half-selling it.
         */
        if (variant.trackSerial) {
          const serials = line.serials ?? [];
          if (!Number.isInteger(line.quantity) || serials.length !== line.quantity) {
            throw new AppError(
              ERROR_CODES.VALIDATION_FAILED,
              `${variant.productName} tracks serial numbers — list exactly ${line.quantity} of them.`,
              { line: variant.sku, quantity: line.quantity, serialsGiven: serials.length },
            );
          }
        }

        return {
          ...line,
          variant,
          unitPrice,
          discountPercent,
          taxPercent: variant.taxRate ?? String(settings.tax.defaultRate),
          costPrice: price?.purchasePrice ?? null,
        };
      });

      // --- totals, from the shared engine ---------------------------------
      const totals = calculateDocument({
        taxMode: settings.tax.mode,
        decimals: settings.currency.decimals,
        ...(dto.documentDiscountPercent
          ? { documentDiscountPercent: String(dto.documentDiscountPercent) }
          : {}),
        lines: lines.map((l) => ({
          quantity: String(l.quantity),
          unitPrice: l.unitPrice,
          discountPercent: l.discountPercent,
          taxPercent: l.taxPercent,
        })),
      });

      /** ABAC: the per-sale ceiling. */
      if (user.abac.maxSaleAmount) {
        const ceiling = Money.toMinor(user.abac.maxSaleAmount);
        if (totals.total > ceiling) {
          throw new AppError(
            ERROR_CODES.AMOUNT_EXCEEDS_LIMIT,
            `This sale is ${Money.toDecimalString(totals.total, 2)}, above your ${user.abac.maxSaleAmount} limit.`,
          );
        }
      }

      // --- payment and credit ---------------------------------------------
      /**
       * Tendered is not the same as taken.
       *
       * A customer hands over 100 for a 5.78 basket; 94.22 goes straight back
       * as change. Recording the tender would book that change as revenue —
       * the drawer reads 94.22 over at close-out, the day's cash total is
       * wrong, and every VAT figure derived from it is wrong too.
       *
       * So each tender is ALLOCATED against what is still owed, and only the
       * allocated part becomes a payment row.
       */
      // Fetched once, up front: credit, loyalty redemption AND loyalty earning
      // below all need the same row, and a second query would just be a second
      // chance for it to have changed underneath this transaction.
      const customer = dto.customerId
        ? await tx.query.customers.findFirst({ where: (t, { eq: e }) => e(t.id, dto.customerId!) })
        : null;
      if (dto.customerId && !customer) {
        throw new AppError(ERROR_CODES.CUSTOMER_NOT_FOUND, "Customer not found");
      }

      /**
       * Loyalty redemption funds the sale exactly like a payment does — it is
       * applied before any tender, and reduces what is left to pay in cash or
       * by card.
       *
       * Capped at the sale total rather than partially honoured: redeeming 300
       * points against a 2.00 basket would burn value the customer never
       * received, and there is no clean way to hand fractional points back.
       * The fix is asking for fewer points, not silently keeping the rest.
       */
      let redemptionValue = 0n;
      if (dto.redeemPoints) {
        if (!customer) {
          throw new AppError(
            ERROR_CODES.VALIDATION_FAILED,
            "Redeeming loyalty points needs a customer attached to the sale.",
          );
        }
        if (!settings.loyalty.enabled) {
          throw new AppError(ERROR_CODES.VALIDATION_FAILED, "Loyalty points are not enabled.");
        }
        if (customer.loyaltyPoints < settings.loyalty.minimumRedeemable) {
          throw new AppError(
            ERROR_CODES.VALIDATION_FAILED,
            `${customer.name} needs at least ${settings.loyalty.minimumRedeemable} points before any can be redeemed. They have ${customer.loyaltyPoints}.`,
          );
        }
        if (dto.redeemPoints > customer.loyaltyPoints) {
          throw new AppError(
            ERROR_CODES.VALIDATION_FAILED,
            `${customer.name} only has ${customer.loyaltyPoints} points.`,
          );
        }

        redemptionValue = Money.multiplyByQuantity(
          Money.toMinor(String(settings.loyalty.redemptionValue)),
          dto.redeemPoints,
        );

        if (redemptionValue > totals.total) {
          throw new AppError(
            ERROR_CODES.VALIDATION_FAILED,
            `${dto.redeemPoints} points are worth ${Money.toDecimalString(redemptionValue, 2)}, more than the ${Money.toDecimalString(totals.total, 2)} owed. Redeem fewer points.`,
          );
        }
      }

      /**
       * `loyalty_points` is not a tender a terminal can claim — it is a
       * server-computed value from `redeemPoints`, backed by a ledger row and
       * a real deduction. Accepting it here would let any caller fabricate a
       * payment with no points ever spent.
       */
      if ((dto.payments ?? []).some((p) => p.method === "loyalty_points")) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          "loyalty_points is not a tender. Use redeemPoints to spend loyalty points.",
        );
      }

      const tendered = (dto.payments ?? []).reduce<bigint>(
        (sum, p) => Money.add(sum, Money.toMinor(String(p.amount))),
        0n,
      );
      const funded = Money.add(redemptionValue, tendered);
      const paid = Money.min(funded, totals.total);
      const due = Money.max(Money.subtract(totals.total, paid), 0n);
      const change = Money.max(Money.subtract(funded, totals.total), 0n);

      if (Money.isPositive(due)) {
        // Unpaid means it goes on an account, and a walk-in has none.
        if (!customer) {
          throw new AppError(
            ERROR_CODES.VALIDATION_FAILED,
            "A partly paid sale must be attached to a customer.",
          );
        }

        if (customer.creditOnHold) {
          throw new AppError(
            ERROR_CODES.CREDIT_LIMIT_EXCEEDED,
            `${customer.name} is on credit hold.`,
          );
        }

        /**
         * A supervisor may take a good customer past their limit, and the POS
         * already asked for that approval at the counter. Without honouring
         * the grant here the sale would be refused on push anyway, hours after
         * the manager said yes and the goods went out of the door.
         *
         * Grants only, not the caller's own permissions: holding
         * `customer:credit` is authority to APPROVE going over a limit, not a
         * standing exemption from every limit on every sale you ring up.
         */
        const creditApproved = hasPermission(
          OverrideGrantsService.permissionsWith([], approvals),
          "customer:credit",
        );

        if (settings.sales.enforceCreditLimit && !creditApproved) {
          const after = Money.add(Money.toMinor(customer.creditBalance), due);
          if (after > Money.toMinor(customer.creditLimit)) {
            throw new AppError(
              ERROR_CODES.CREDIT_LIMIT_EXCEEDED,
              `This would take ${customer.name} to ${Money.toDecimalString(after, 2)}, past their ${customer.creditLimit} limit.`,
              { limit: customer.creditLimit, balance: customer.creditBalance, due: Money.toDecimalString(due, 2) },
            );
          }
        }
      }

      // --- everything below WRITES ----------------------------------------

      const branch = await tx.query.branches.findFirst({
        where: (t, { eq: e }) => e(t.id, dto.branchId),
        columns: { code: true },
      });
      const year = new Date().getFullYear();
      const [seq] = await tx.execute<{ next_document_number: number }>(
        sql`SELECT next_document_number(${tenantId}::uuid, ${sequenceKey("sale", year, branch?.code ?? null)})`,
      );
      const saleNumber = formatDocumentNumber({
        kind: "sale",
        year,
        sequence: Number((seq as { next_document_number?: number })?.next_document_number ?? 1),
        ...(branch?.code ? { branchCode: branch.code } : {}),
      });

      const [sale] = await tx
        .insert(schema.sales)
        .values({
          tenantId,
          branchId: dto.branchId,
          saleNumber,
          customerId: dto.customerId ?? null,
          cashSessionId: dto.cashSessionId ?? null,
          source: dto.source ?? "pos",
          status: "completed",
          currency: settings.currency.base,
          taxMode: settings.tax.mode,
          subtotal: Money.toDecimalString(totals.subtotal, 4),
          discountAmount: Money.toDecimalString(totals.discountAmount, 4),
          taxAmount: Money.toDecimalString(totals.taxAmount, 4),
          total: Money.toDecimalString(totals.total, 4),
          paidAmount: Money.toDecimalString(paid, 4),
          dueAmount: Money.toDecimalString(due, 4),
          createdBy: user.id,
          ...(dto.localId ? { localId: dto.localId } : {}),
          ...(user.deviceId ? { deviceId: user.deviceId } : {}),
          // The terminal's clock is what belongs on the receipt; createdAt is
          // when the server first saw it. On an offline sale they differ.
          ...(dto.occurredAt ? { occurredAt: new Date(dto.occurredAt) } : {}),
          ...(dto.notes ? { notes: dto.notes } : {}),
        })
        .returning();

      if (!sale) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not create the sale");

      for (const [index, line] of lines.entries()) {
        const computed = totals.lines[index]!;

        const [item] = await tx
          .insert(schema.saleItems)
          .values({
            tenantId,
            saleId: sale.id,
            variantId: line.variantId,
            // Snapshotted: renaming a product must not rewrite last year's invoice.
            productName: line.variant.productName,
            variantName: line.variant.variantName,
            productSku: line.variant.sku,
            quantity: String(line.quantity),
            unitPrice: line.unitPrice,
            discountPercent: line.discountPercent,
            discountAmount: Money.toDecimalString(computed.discount, 4),
            taxPercent: line.taxPercent,
            taxAmount: Money.toDecimalString(computed.tax, 4),
            lineSubtotal: Money.toDecimalString(computed.net, 4),
            total: Money.toDecimalString(computed.total, 4),
            // Margin must not shift when the next purchase order changes the
            // average cost, so it is captured here.
            ...(line.costPrice ? { costPrice: line.costPrice } : {}),
            sortOrder: index,
          })
          .returning({ id: schema.saleItems.id });

        // Services and labour have no stock to move.
        if (line.variant.isStockTracked) {
          await this.stock.deductStock({
            tx,
            variantId: line.variantId,
            branchId: dto.branchId,
            quantity: String(line.quantity),
            referenceType: "sale",
            referenceId: sale.id,
            ...(line.costPrice ? { unitCost: line.costPrice } : {}),
            ...(user.deviceId ? { deviceId: user.deviceId } : {}),
          });
        }

        if (line.variant.trackSerial && item) {
          await this.serials.assignAtSale(tx, {
            branchId: dto.branchId,
            variantId: line.variantId,
            serials: line.serials ?? [],
            saleItemId: item.id,
          });
        }
      }

      /**
       * The redemption becomes its own payment row, method `loyalty_points`,
       * so a receipt and the tender-split report both show it as a distinct
       * funding source rather than folding it silently into cash.
       */
      if (Money.isPositive(redemptionValue)) {
        await tx.insert(schema.payments).values({
          tenantId,
          branchId: dto.branchId,
          saleId: sale.id,
          customerId: dto.customerId ?? null,
          cashSessionId: dto.cashSessionId ?? null,
          method: "loyalty_points",
          amount: Money.toDecimalString(redemptionValue, 4),
          currency: settings.currency.base,
          reference: `${dto.redeemPoints} points`,
          createdBy: user.id,
          ...(dto.occurredAt ? { occurredAt: new Date(dto.occurredAt) } : {}),
        });

        await tx.insert(schema.loyaltyTransactions).values({
          tenantId,
          customerId: dto.customerId!,
          points: -dto.redeemPoints!,
          type: "redeemed",
          referenceType: "sale",
          referenceId: sale.id,
          createdBy: user.id,
        });

        await tx
          .update(schema.customers)
          .set({ loyaltyPoints: sql`${schema.customers.loyaltyPoints} - ${dto.redeemPoints}` })
          .where(eq(schema.customers.id, dto.customerId!));
      }

      let unallocated = Money.subtract(totals.total, redemptionValue);
      for (const payment of dto.payments ?? []) {
        const offered = Money.toMinor(String(payment.amount));
        const applied = Money.min(offered, unallocated);
        unallocated = Money.subtract(unallocated, applied);

        /**
         * Change comes out of the drawer, so only cash can produce it. A card
         * charged above the total is an overcharge, not change — silently
         * dropping the excess would leave the customer's statement and the
         * receipt disagreeing, with nothing recorded to explain it.
         */
        if (applied !== offered && payment.method !== "cash") {
          throw new AppError(
            ERROR_CODES.VALIDATION_FAILED,
            `A ${payment.method} payment cannot exceed the amount due. Change can only be given in cash.`,
          );
        }

        // A tender that lands entirely on already-settled value is not a
        // payment at all — recording a zero row would clutter every statement.
        if (!Money.isPositive(applied)) continue;

        await tx.insert(schema.payments).values({
          tenantId,
          branchId: dto.branchId,
          saleId: sale.id,
          customerId: dto.customerId ?? null,
          cashSessionId: dto.cashSessionId ?? null,
          method: payment.method as PaymentMethod,
          amount: Money.toDecimalString(applied, 4),
          currency: settings.currency.base,
          ...(payment.reference ? { reference: payment.reference } : {}),
          createdBy: user.id,
          ...(dto.occurredAt ? { occurredAt: new Date(dto.occurredAt) } : {}),
        });
      }

      // The cached balance moves in the same transaction as the sale that
      // caused it, so the two can never disagree.
      if (Money.isPositive(due) && dto.customerId) {
        await tx
          .update(schema.customers)
          .set({
            creditBalance: sql`${schema.customers.creditBalance} + ${Money.toDecimalString(due, 4)}::numeric`,
          })
          .where(eq(schema.customers.id, dto.customerId));
      }

      /**
       * Earn points on what the sale actually took, spent points included —
       * a customer who redeemed part of the total is still a customer whose
       * business was worth having.
       *
       * Computed in BigInt throughout rather than converting to a float: the
       * rate and the total are both scaled by 10^4, so the product carries
       * 10^8 and has to come back down by the SAME factor before it is a
       * plain point count — the identical trap `divideByQuantity` exists for.
       */
      if (settings.loyalty.enabled && dto.customerId && !Money.isNegative(totals.total)) {
        const rateMinor = Money.toMinor(String(settings.loyalty.pointsPerCurrencyUnit));
        const pointsEarned = Number((totals.total * rateMinor) / (10_000n * 10_000n));

        if (pointsEarned > 0) {
          await tx.insert(schema.loyaltyTransactions).values({
            tenantId,
            customerId: dto.customerId,
            points: pointsEarned,
            type: "earned",
            referenceType: "sale",
            referenceId: sale.id,
            createdBy: user.id,
          });

          await tx
            .update(schema.customers)
            .set({ loyaltyPoints: sql`${schema.customers.loyaltyPoints} + ${pointsEarned}` })
            .where(eq(schema.customers.id, dto.customerId));
        }
      }

      const created = await this.findById(sale.id, tx);
      return { ...(created as object), change: Money.toDecimalString(change, 2) };
    });
  }

  async findById(
    id: string,
    existingTx?: Parameters<Parameters<TenantDatabase["run"]>[0]>[0],
  ): Promise<unknown> {
    const read = async (tx: Parameters<Parameters<TenantDatabase["run"]>[0]>[0]) => {
      const sale = await tx.query.sales.findFirst({
        where: (t, { eq: e }) => e(t.id, id),
      });
      if (!sale) throw new AppError(ERROR_CODES.NOT_FOUND, `Sale ${id} not found`);
      assertBranchInScope(sale.branchId);

      const [items, payments] = await Promise.all([
        tx
          .select()
          .from(schema.saleItems)
          .where(eq(schema.saleItems.saleId, id))
          .orderBy(schema.saleItems.sortOrder),
        tx.select().from(schema.payments).where(eq(schema.payments.saleId, id)),
      ]);

      const canViewCost = RequestContext.get()?.user?.abac.canViewCost ?? false;

      return {
        ...sale,
        items: items.map(({ costPrice, ...item }) =>
          canViewCost ? { ...item, costPrice } : item,
        ),
        payments,
      };
    };

    return existingTx ? read(existingTx) : this.db.run(read);
  }

  async list(query: {
    page: number;
    limit: number;
    branchId?: string;
    customerId?: string;
    from?: string;
    to?: string;
  }): Promise<unknown> {
    const offset = (query.page - 1) * query.limit;

    if (query.branchId) assertBranchInScope(query.branchId);

    // The UI's default call names no branch. Unfiltered, that returned every
    // sale in the business — takings, customers and cashier names included —
    // to anybody with `sale:read` at one shop.
    const scope = branchScope();

    return this.db.run(async (tx) => {
      const where = and(
        scope ? inArray(schema.sales.branchId, scope) : undefined,
        query.branchId ? eq(schema.sales.branchId, query.branchId) : undefined,
        query.customerId ? eq(schema.sales.customerId, query.customerId) : undefined,
        query.from ? sql`${schema.sales.occurredAt} >= ${query.from}::date` : undefined,
        query.to ? sql`${schema.sales.occurredAt} < (${query.to}::date + 1)` : undefined,
      );

      const items = await tx
        .select({
          id: schema.sales.id,
          saleNumber: schema.sales.saleNumber,
          occurredAt: schema.sales.occurredAt,
          total: schema.sales.total,
          paidAmount: schema.sales.paidAmount,
          dueAmount: schema.sales.dueAmount,
          status: schema.sales.status,
          branchName: schema.branches.name,
          customerName: schema.customers.name,
          cashierName: schema.users.name,
        })
        .from(schema.sales)
        .innerJoin(schema.branches, eq(schema.sales.branchId, schema.branches.id))
        .leftJoin(schema.customers, eq(schema.sales.customerId, schema.customers.id))
        .leftJoin(schema.users, eq(schema.sales.createdBy, schema.users.id))
        .where(where)
        .orderBy(desc(schema.sales.occurredAt))
        .limit(query.limit)
        .offset(offset);

      return { items, meta: { page: query.page, limit: query.limit } };
    });
  }
}
