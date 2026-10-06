import { and, eq, inArray, schema, sql, type Transaction } from "@devsfleet/db";
import type { Cart } from "@devsfleet/db";
import { AppError, calculateDocument, calculateLine, ERROR_CODES, Money, type DocumentTotals } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../../common/context/request-context.js";
import { TenantDatabase } from "../../../database/tenant-database.service.js";
import { currentShopper } from "../context/storefront.guard.js";
import { moneyView, type MoneyView } from "../pricing/money-view.js";
import { StorefrontPricing, type PricedLine } from "../pricing/storefront-pricing.service.js";
import { CouponsService, type CouponEffect } from "./coupons.service.js";

const MAX_QUANTITY = Money.toMinor("100000");

export type CartIssueCode = "PRICE_CHANGED" | "OUT_OF_STOCK" | "UNAVAILABLE" | "PICKUP_ONLY_ITEMS";
export interface CartIssue {
  code: CartIssueCode;
  sku?: string;
  message: string;
}

export interface CartLine {
  id: string;
  variantId: string;
  unitId: string;
  /** Sold loose, in the product's own unit — an order line then names no packaging. */
  isBaseUnit: boolean;
  uom: string;
  quantity: string;
  conversionFactor: string;
  /** quantity x conversionFactor — what stock is held and moved in. */
  baseQuantity: string;
  sku: string;
  productName: string;
  variantName: string;
  productSlug: string | null;
  imageUrl: string | null;
  pickupOnly: boolean;
  weightKg: string | null;
  isStockTracked: boolean;
  seenUnitPrice: string | null;
  /** null = no longer sold online: unpublished, deactivated, or unpriced. */
  priced: PricedLine | null;
}

export interface PricedCart {
  cart: Cart;
  lines: CartLine[];
  coupon: CouponEffect | null;
  couponError: string | null;
}

/** A delivery fee, as one more line on the same document. */
export interface DeliveryLine {
  variantId: string;
  /** Per the tenant's tax mode, like any unit price. */
  unitPrice: string;
  taxPercent: string;
}

/**
 * The shopper's basket.
 *
 * Holds variant, unit and quantity — never a price. Every read re-prices
 * through StorefrontPricing (the till's ladder) and totals through
 * calculateDocument, so what the cart shows is what an order placed this
 * second would charge. `seenUnitPrice` exists only to notice when that figure
 * moved since the shopper last looked.
 */
@Injectable()
export class CartService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly pricing: StorefrontPricing,
    private readonly coupons: CouponsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Commands — each returns the cart view and, for a new guest, its id to cookie
  // ---------------------------------------------------------------------------

  async view(guestCartId: string | undefined) {
    return this.db.run(async (tx) => {
      const { cart, created } = await this.resolve(tx, guestCartId);
      return { view: await this.render(tx, cart), newGuestCartId: created ? cart.id : null };
    });
  }

  async addItem(guestCartId: string | undefined, input: { variantId: string; uom?: string; quantity: number }) {
    return this.db.run(async (tx) => {
      const { cart, created } = await this.resolve(tx, guestCartId);
      const unit = await this.unitFor(tx, input.variantId, input.uom);

      const existing = await tx.query.cartItems.findFirst({
        where: (t, { and: a, eq: e }) => a(e(t.cartId, cart.id), e(t.variantId, input.variantId), e(t.unitId, unit.unitId)),
      });
      const quantity = Money.add(Money.toMinor(existing?.quantity ?? "0"), Money.toMinor(String(input.quantity)));
      this.assertQuantity(quantity, unit.allowsFractions);

      const [line] = await this.pricing.priceLines(
        tx,
        [{ variantId: input.variantId, unitId: unit.unitId, quantity: Money.toDecimalString(quantity, 4), taxRate: unit.taxRate, packaging: unit.packaging }],
        currentShopper()?.customerId ?? null,
      );
      if (!line) throw new AppError(ERROR_CODES.NO_PRICE_FOR_PRODUCT, "This item cannot be bought online right now.");

      const tenantId = RequestContext.requireTenantId();
      await tx
        .insert(schema.cartItems)
        .values({
          tenantId,
          cartId: cart.id,
          variantId: input.variantId,
          unitId: unit.unitId,
          quantity: Money.toDecimalString(quantity, 4),
          seenUnitPrice: line.unitPrice,
        })
        .onConflictDoUpdate({
          target: [schema.cartItems.cartId, schema.cartItems.variantId, schema.cartItems.unitId],
          set: { quantity: Money.toDecimalString(quantity, 4), seenUnitPrice: line.unitPrice, updatedAt: new Date() },
        });
      await this.touch(tx, cart.id);
      return { view: await this.render(tx, cart), newGuestCartId: created ? cart.id : null };
    });
  }

  /** 0 removes the line. */
  async updateItem(guestCartId: string | undefined, itemId: string, quantity: number) {
    return this.db.run(async (tx) => {
      const { cart } = await this.resolve(tx, guestCartId);
      const item = await this.ownedItem(tx, cart.id, itemId);
      if (quantity <= 0) {
        await tx.delete(schema.cartItems).where(eq(schema.cartItems.id, item.id));
      } else {
        const unit = await this.unitFor(tx, item.variantId, undefined, item.unitId);
        const minor = Money.toMinor(String(quantity));
        this.assertQuantity(minor, unit.allowsFractions);
        const [line] = await this.pricing.priceLines(
          tx,
          [{ variantId: item.variantId, unitId: item.unitId, quantity: Money.toDecimalString(minor, 4), taxRate: unit.taxRate, packaging: unit.packaging }],
          currentShopper()?.customerId ?? null,
        );
        await tx
          .update(schema.cartItems)
          .set({ quantity: Money.toDecimalString(minor, 4), seenUnitPrice: line?.unitPrice ?? item.seenUnitPrice })
          .where(eq(schema.cartItems.id, item.id));
      }
      await this.touch(tx, cart.id);
      return { view: await this.render(tx, cart), newGuestCartId: null };
    });
  }

  async removeItem(guestCartId: string | undefined, itemId: string) {
    return this.updateItem(guestCartId, itemId, 0);
  }

  async setCoupon(guestCartId: string | undefined, code: string | null) {
    return this.db.run(async (tx) => {
      const { cart } = await this.resolve(tx, guestCartId);
      if (code) {
        const priced = await this.price(tx, cart);
        // Throws the reason a shopper can act on: expired, minimum spend…
        await this.coupons.evaluate(tx, code, this.goodsNet(priced));
      }
      const couponCode = code ? code.trim().toUpperCase() : null;
      await tx.update(schema.carts).set({ couponCode }).where(eq(schema.carts.id, cart.id));
      return { view: await this.render(tx, { ...cart, couponCode }), newGuestCartId: null };
    });
  }

  /**
   * On sign-in: fold the guest cart into the account's. Quantities add up
   * rather than one cart replacing the other — whatever was put in a basket
   * before logging in is still there after.
   */
  async adoptGuestCart(tx: Transaction, guestCartId: string | undefined, accountId: string): Promise<void> {
    if (!guestCartId) return;
    const guest = await tx.query.carts.findFirst({
      where: (t, { and: a, eq: e, isNull: n }) => a(e(t.id, guestCartId), e(t.status, "active"), n(t.accountId)),
    });
    if (!guest) return;

    const mine = await this.accountCart(tx, accountId);
    if (!mine) {
      await tx.update(schema.carts).set({ accountId }).where(eq(schema.carts.id, guest.id));
      return;
    }

    const items = await tx.query.cartItems.findMany({ where: (t, { eq: e }) => e(t.cartId, guest.id) });
    const tenantId = RequestContext.requireTenantId();
    for (const item of items) {
      await tx
        .insert(schema.cartItems)
        .values({ tenantId, cartId: mine.id, variantId: item.variantId, unitId: item.unitId, quantity: item.quantity, seenUnitPrice: item.seenUnitPrice })
        .onConflictDoUpdate({
          target: [schema.cartItems.cartId, schema.cartItems.variantId, schema.cartItems.unitId],
          set: { quantity: sql`${schema.cartItems.quantity} + ${item.quantity}::numeric`, updatedAt: new Date() },
        });
    }
    if (guest.couponCode && !mine.couponCode) {
      await tx.update(schema.carts).set({ couponCode: guest.couponCode }).where(eq(schema.carts.id, mine.id));
    }
    await tx.update(schema.carts).set({ status: "converted" }).where(eq(schema.carts.id, guest.id));
  }

  // ---------------------------------------------------------------------------
  // Pricing — shared with checkout
  // ---------------------------------------------------------------------------

  /** The visitor's active cart, without creating one. */
  async find(tx: Transaction, guestCartId: string | undefined): Promise<Cart | null> {
    const shopper = currentShopper();
    if (shopper) return (await this.accountCart(tx, shopper.accountId)) ?? null;
    if (!guestCartId) return null;
    return (
      (await tx.query.carts.findFirst({
        where: (t, { and: a, eq: e, isNull: n }) => a(e(t.id, guestCartId), e(t.status, "active"), n(t.accountId)),
      })) ?? null
    );
  }

  /** The visitor's active cart: the account's when signed in, else the cookie's. */
  async resolve(tx: Transaction, guestCartId: string | undefined): Promise<{ cart: Cart; created: boolean }> {
    const shopper = currentShopper();
    if (shopper) {
      const mine = await this.accountCart(tx, shopper.accountId);
      if (mine) return { cart: mine, created: false };
    } else if (guestCartId) {
      const guest = await tx.query.carts.findFirst({
        where: (t, { and: a, eq: e, isNull: n }) => a(e(t.id, guestCartId), e(t.status, "active"), n(t.accountId)),
      });
      if (guest) return { cart: guest, created: false };
    }
    const tenantId = RequestContext.requireTenantId();
    const [cart] = await tx
      .insert(schema.carts)
      .values({ tenantId, accountId: shopper?.accountId ?? null })
      .returning();
    return { cart: cart!, created: !shopper };
  }

  async price(tx: Transaction, cart: Cart): Promise<PricedCart> {
    const rows = await tx
      .select({
        id: schema.cartItems.id,
        variantId: schema.cartItems.variantId,
        unitId: schema.cartItems.unitId,
        quantity: schema.cartItems.quantity,
        seenUnitPrice: schema.cartItems.seenUnitPrice,
        sku: schema.productVariants.sku,
        variantName: schema.productVariants.variantName,
        variantActive: schema.productVariants.isActive,
        variantDeletedAt: schema.productVariants.deletedAt,
        weight: schema.productVariants.weight,
        variantImage: schema.productVariants.imageUrl,
        productName: schema.products.name,
        productActive: schema.products.isActive,
        productDeletedAt: schema.products.deletedAt,
        productImage: schema.products.imageUrl,
        taxRate: schema.products.taxRate,
        isStockTracked: schema.products.isStockTracked,
        baseUnitId: schema.products.unitId,
        slug: schema.productListings.slug,
        published: schema.productListings.isPublished,
        pickupOnly: schema.productListings.pickupOnly,
      })
      .from(schema.cartItems)
      .innerJoin(schema.productVariants, eq(schema.cartItems.variantId, schema.productVariants.id))
      .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
      .leftJoin(schema.productListings, eq(schema.productListings.productId, schema.products.id))
      .where(eq(schema.cartItems.cartId, cart.id))
      .orderBy(schema.cartItems.createdAt);

    const unitIds = [...new Set(rows.map((r) => r.unitId))];
    const [units, packagings] = await Promise.all([
      unitIds.length
        ? tx.select({ id: schema.units.id, abbreviation: schema.units.abbreviation }).from(schema.units).where(inArray(schema.units.id, unitIds))
        : [],
      rows.length
        ? tx
            .select()
            .from(schema.variantUnits)
            .where(inArray(schema.variantUnits.variantId, rows.map((r) => r.variantId)))
        : [],
    ]);
    const abbreviationBy = new Map(units.map((u) => [u.id, u.abbreviation]));
    const packagingBy = new Map(packagings.map((p) => [`${p.variantId}:${p.unitId}`, p]));

    const shaped = rows.map((row) => {
      const isBase = row.unitId === row.baseUnitId;
      const packaging = isBase ? null : packagingBy.get(`${row.variantId}:${row.unitId}`);
      const sellable =
        row.variantActive && !row.variantDeletedAt && row.productActive && !row.productDeletedAt &&
        row.published === true && (isBase || packaging?.isSellable === true);
      const conversionFactor = packaging?.conversionFactor ?? "1";
      return {
        row,
        isBase,
        sellable,
        conversionFactor,
        packaging: { unitId: row.unitId, uom: abbreviationBy.get(row.unitId) ?? "", conversionFactor, priceOverride: packaging?.priceOverride ?? null },
      };
    });

    const priced = await this.pricing.priceLines(
      tx,
      shaped.filter((s) => s.sellable).map((s) => ({
        variantId: s.row.variantId,
        unitId: s.row.unitId,
        quantity: s.row.quantity,
        taxRate: s.row.taxRate,
        packaging: s.packaging,
      })),
      currentShopper()?.customerId ?? null,
    );
    let cursor = 0;

    const lines: CartLine[] = shaped.map((s) => ({
      id: s.row.id,
      variantId: s.row.variantId,
      unitId: s.row.unitId,
      isBaseUnit: s.isBase,
      uom: s.packaging.uom,
      quantity: s.row.quantity,
      conversionFactor: s.conversionFactor,
      baseQuantity: Money.toDecimalString(Money.multiplyByQuantity(Money.toMinor(s.row.quantity), s.conversionFactor), 4),
      sku: s.row.sku,
      productName: s.row.productName,
      variantName: s.row.variantName,
      productSlug: s.row.slug,
      imageUrl: s.row.variantImage ?? s.row.productImage,
      pickupOnly: s.row.pickupOnly === true,
      weightKg: s.row.weight,
      isStockTracked: s.row.isStockTracked,
      seenUnitPrice: s.row.seenUnitPrice,
      priced: s.sellable ? (priced[cursor++] ?? null) : null,
    }));

    let coupon: CouponEffect | null = null;
    let couponError: string | null = null;
    if (cart.couponCode) {
      try {
        coupon = await this.coupons.evaluate(tx, cart.couponCode, this.goodsNet({ cart, lines, coupon: null, couponError: null }));
      } catch (error) {
        couponError = error instanceof AppError ? error.message : "This promo code cannot be used.";
      }
    }
    return { cart, lines, coupon, couponError };
  }

  /**
   * The document an order placed now would be: goods (with the coupon's
   * percentage) plus, when given, the delivery line. One calculateDocument
   * call, the same one OrdersService makes for the order itself.
   */
  document(priced: PricedCart, delivery?: DeliveryLine | null): { totals: DocumentTotals; goodsCount: number } {
    const { tenantSettings } = RequestContext.requireStorefront();
    const goods = priced.lines.filter((l) => l.priced);
    const lines = goods.map((l) => ({
      quantity: l.quantity,
      unitPrice: l.priced!.unitPrice,
      discountPercent: priced.coupon?.discountPercent ?? "0",
      taxPercent: l.priced!.taxPercent,
    }));
    if (delivery) lines.push({ quantity: "1", unitPrice: delivery.unitPrice, discountPercent: "0", taxPercent: delivery.taxPercent });

    const totals = calculateDocument({
      taxMode: tenantSettings.tax.mode,
      decimals: tenantSettings.currency.decimals,
      lines,
    });
    return { totals, goodsCount: goods.length };
  }

  /** Net value of the goods before any coupon — what a minimum spend is measured against. */
  goodsNet(priced: PricedCart): bigint {
    const { tenantSettings } = RequestContext.requireStorefront();
    const goods = priced.lines.filter((l) => l.priced);
    if (goods.length === 0) return 0n;
    return calculateDocument({
      taxMode: tenantSettings.tax.mode,
      decimals: tenantSettings.currency.decimals,
      lines: goods.map((l) => ({ quantity: l.quantity, unitPrice: l.priced!.unitPrice, taxPercent: l.priced!.taxPercent })),
    }).subtotal;
  }

  /** Total weight in kg, for courier pricing. A variant with no weight counts as nothing. */
  weightKg(priced: PricedCart): bigint {
    return priced.lines
      .filter((l) => l.priced && l.weightKg)
      .reduce((sum, l) => sum + Money.multiplyByQuantity(Money.toMinor(l.weightKg!), l.baseQuantity), 0n);
  }

  /**
   * What cannot be promised, and why. `branchIds` is where the goods would
   * come from: every branch shown online for the cart page, the one branch
   * for checkout. `lock` takes the rows FOR UPDATE, for the checkout that is
   * about to reserve them.
   */
  async issues(
    tx: Transaction,
    priced: PricedCart,
    options: { branchIds: string[]; lock?: boolean },
  ): Promise<CartIssue[]> {
    const issues: CartIssue[] = [];
    for (const line of priced.lines) {
      if (!line.priced) {
        issues.push({ code: "UNAVAILABLE", sku: line.sku, message: `${line.productName} is no longer available online.` });
      } else if (line.seenUnitPrice && Money.toMinor(line.seenUnitPrice) !== Money.toMinor(line.priced.unitPrice)) {
        issues.push({ code: "PRICE_CHANGED", sku: line.sku, message: `The price of ${line.productName} has changed.` });
      }
    }

    const needed = new Map<string, bigint>();
    for (const line of priced.lines) {
      if (!line.priced || !line.isStockTracked) continue;
      needed.set(line.variantId, (needed.get(line.variantId) ?? 0n) + Money.toMinor(line.baseQuantity));
    }
    if (needed.size > 0 && options.branchIds.length > 0) {
      const { settings } = RequestContext.requireStorefront();
      const buffer = Money.toMinor(String(settings.checkout.stockSafetyBuffer));
      const rows = await tx.execute<{ variant_id: string; free: string }>(sql`
        SELECT variant_id, (quantity - reserved_quantity)::text AS free
        FROM inventory
        WHERE variant_id IN (${sql.join([...needed.keys()].map((id) => sql`${id}`), sql`, `)})
          AND branch_id IN (${sql.join(options.branchIds.map((id) => sql`${id}`), sql`, `)})
        ${options.lock ? sql`FOR UPDATE` : sql``}`);

      const free = new Map<string, bigint>();
      for (const row of rows) {
        const available = Money.max(Money.toMinor(row.free) - buffer, 0n);
        free.set(row.variant_id, (free.get(row.variant_id) ?? 0n) + available);
      }
      for (const [variantId, need] of needed) {
        const have = free.get(variantId) ?? 0n;
        if (have >= need) continue;
        const line = priced.lines.find((l) => l.variantId === variantId)!;
        const inUnits = Money.divideByQuantity(have, line.conversionFactor);
        issues.push({
          code: "OUT_OF_STOCK",
          sku: line.sku,
          message: Money.isPositive(have)
            ? `Only ${Money.toDecimalString(Money.roundTo(inUnits, 0), 0)} ${line.uom} of ${line.productName} available${options.branchIds.length === 1 ? " at this branch" : ""}.`
            : `${line.productName} is out of stock${options.branchIds.length === 1 ? " at this branch" : ""}.`,
        });
      }
    }

    if (priced.lines.some((l) => l.priced && l.pickupOnly)) {
      issues.push({ code: "PICKUP_ONLY_ITEMS", message: "Some items are available for store pickup only." });
    }
    return issues;
  }

  /** The shopper has seen the new prices. Called when checkout refuses on PRICE_CHANGED. */
  async acceptPrices(tx: Transaction, priced: PricedCart): Promise<void> {
    for (const line of priced.lines) {
      if (!line.priced || line.seenUnitPrice === line.priced.unitPrice) continue;
      await tx.update(schema.cartItems).set({ seenUnitPrice: line.priced.unitPrice }).where(eq(schema.cartItems.id, line.id));
    }
  }

  async render(tx: Transaction, cart: Cart) {
    const priced = await this.price(tx, cart);
    const { totals } = this.document(priced);
    const branchIds = await this.shownBranchIds(tx);
    const issues = await this.issues(tx, priced, { branchIds });
    const nextTiers = await this.nextTiers(tx, priced);
    const view = this.moneyOf();

    return {
      id: cart.id,
      items: priced.lines.map((line) => {
        const unit = line.priced ? this.lineGross(line.priced.unitPrice, line.priced.taxPercent, "1") : null;
        return {
          id: line.id,
          variantId: line.variantId,
          sku: line.sku,
          productSlug: line.productSlug ?? "",
          productName: line.productName,
          variantName: line.variantName,
          imageUrl: line.imageUrl,
          uom: line.uom,
          quantity: Number(line.quantity),
          pickupOnly: line.pickupOnly,
          weightGrams: line.weightKg ? Number(Money.toDecimalString(Money.multiplyByQuantity(Money.toMinor(line.weightKg), line.baseQuantity) * 1000n, 0)) : 0,
          available: !!line.priced,
          unitPrice: unit ? view(unit) : null,
          retailUnitPrice: line.priced ? view(this.lineGross(line.priced.retailUnitPrice, line.priced.taxPercent, "1")) : null,
          // Before the coupon, as the shelf price times the quantity; the coupon is its own row in the totals.
          lineTotal: line.priced ? view(this.lineGross(line.priced.unitPrice, line.priced.taxPercent, line.quantity)) : null,
          priceChanged: !!line.priced && !!line.seenUnitPrice && Money.toMinor(line.seenUnitPrice) !== Money.toMinor(line.priced.unitPrice),
          nextTier: nextTiers.get(line.id) ?? null,
        };
      }),
      itemCount: priced.lines.filter((l) => l.priced).length,
      couponCode: cart.couponCode,
      couponError: priced.couponError,
      freeShipping: priced.coupon?.freeShipping ?? false,
      totals: this.totalsView(totals),
      issues,
    };
  }

  totalsView(totals: DocumentTotals, deliveryNet: bigint = 0n) {
    const view = this.moneyOf();
    return {
      subtotalNet: view(totals.subtotal + totals.discountAmount - deliveryNet),
      discountNet: view(totals.discountAmount),
      shippingNet: view(deliveryNet),
      vat: view(totals.taxAmount),
      total: view(totals.total),
    };
  }

  async shownBranchIds(tx: Transaction): Promise<string[]> {
    const { settings } = RequestContext.requireStorefront();
    if (settings.branches.length) return settings.branches.map((b) => b.branchId);
    const rows = await tx.query.branches.findMany({
      where: (t, { and: a, eq: e, isNull: n }) => a(e(t.isActive, true), n(t.deletedAt)),
      columns: { id: true },
    });
    return rows.map((r) => r.id);
  }

  moneyOf(): (minor: bigint) => MoneyView {
    const { tenantSettings } = RequestContext.requireStorefront();
    return (minor) => moneyView(minor, tenantSettings.currency.base, tenantSettings.currency.decimals);
  }

  // ---------------------------------------------------------------------------

  /** One line, VAT-inclusive, through the same calculation an order line gets. */
  private lineGross(unitPrice: string, taxPercent: string, quantity: string): bigint {
    const { tenantSettings } = RequestContext.requireStorefront();
    return calculateLine({ quantity, unitPrice, taxPercent }, tenantSettings.tax.mode, tenantSettings.currency.decimals).total;
  }

  private async nextTiers(tx: Transaction, priced: PricedCart) {
    const result = new Map<string, { minQty: number; unitPrice: MoneyView }>();
    const lines = priced.lines.filter((l) => l.priced);
    if (lines.length === 0) return result;

    const sheet = await this.pricing.priceSheet(
      tx,
      lines.map((l) => ({
        variantId: l.variantId,
        taxRate: l.priced!.taxPercent,
        units: [{ unitId: l.unitId, uom: l.uom, conversionFactor: l.conversionFactor, priceOverride: null }],
      })),
      currentShopper()?.customerId ?? null,
    );
    for (const line of lines) {
      const tiers = sheet.get(line.variantId)?.find((u) => u.unitId === line.unitId)?.price.tiers ?? [];
      const next = tiers.find((t) => t.minQty > Number(line.quantity));
      if (next) result.set(line.id, { minQty: next.minQty, unitPrice: next.unit });
    }
    return result;
  }

  private async accountCart(tx: Transaction, accountId: string) {
    return tx.query.carts.findFirst({
      where: (t, { and: a, eq: e }) => a(e(t.accountId, accountId), e(t.status, "active")),
      orderBy: (t, { desc }) => desc(t.updatedAt),
    });
  }

  /**
   * Which unit a shopper means by "box": the product's base unit, or one of
   * the variant's sellable packagings. Anything else is refused rather than
   * guessed — a wrong conversion factor is a wrong price and a wrong stock hold.
   */
  async unitFor(tx: Transaction, variantId: string, uom?: string, unitId?: string) {
    const variant = await tx.query.productVariants.findFirst({
      where: (t, { and: a, eq: e, isNull: n }) => a(e(t.id, variantId), e(t.isActive, true), n(t.deletedAt)),
      with: { product: { with: { unit: true } }, packagings: { with: { unit: true } } },
    });
    const listing = variant
      ? await tx.query.productListings.findFirst({
          where: (t, { and: a, eq: e }) => a(e(t.productId, variant.productId), e(t.isPublished, true)),
          columns: { id: true },
        })
      : null;
    if (!variant || !listing || !variant.product.isActive || variant.product.deletedAt) {
      throw new AppError(ERROR_CODES.PRODUCT_NOT_FOUND, "That product is not available online.");
    }

    const base = variant.product.unit;
    const wanted = (candidate: { id: string; abbreviation: string }) =>
      unitId ? candidate.id === unitId : !uom || candidate.abbreviation.toLowerCase() === uom.toLowerCase();

    if (wanted(base)) {
      return {
        unitId: base.id,
        allowsFractions: base.allowsFractions,
        taxRate: variant.product.taxRate,
        packaging: { unitId: base.id, uom: base.abbreviation, conversionFactor: "1", priceOverride: null },
      };
    }
    const packaging = variant.packagings.find((p) => p.isSellable && wanted(p.unit));
    if (!packaging) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, `${variant.product.name} is not sold per ${uom ?? "that unit"}.`);
    }
    return {
      unitId: packaging.unitId,
      allowsFractions: packaging.unit.allowsFractions,
      taxRate: variant.product.taxRate,
      packaging: {
        unitId: packaging.unitId,
        uom: packaging.unit.abbreviation,
        conversionFactor: packaging.conversionFactor,
        priceOverride: packaging.priceOverride,
      },
    };
  }

  private assertQuantity(quantity: bigint, allowsFractions: boolean): void {
    if (!Money.isPositive(quantity) || quantity > MAX_QUANTITY) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, "That quantity is not valid.");
    }
    // You cannot sell half an elbow: the same rule the till applies to the unit.
    if (!allowsFractions && Money.roundTo(quantity, 0) !== quantity) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, "This item is sold in whole units only.");
    }
  }

  private async ownedItem(tx: Transaction, cartId: string, itemId: string) {
    const item = await tx.query.cartItems.findFirst({
      where: (t, { and: a, eq: e }) => a(e(t.id, itemId), e(t.cartId, cartId)),
    });
    if (!item) throw new AppError(ERROR_CODES.NOT_FOUND, "That item is not in your cart.");
    return item;
  }

  private async touch(tx: Transaction, cartId: string) {
    await tx.update(schema.carts).set({ updatedAt: new Date() }).where(and(eq(schema.carts.id, cartId)));
  }
}
