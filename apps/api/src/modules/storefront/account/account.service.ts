import { and, count, eq, inArray, schema, type Transaction } from "@devsfleet/db";
import { AppError, calculateLine, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../../common/context/request-context.js";
import { TenantDatabase } from "../../../database/tenant-database.service.js";
import { CartService } from "../cart/cart.service.js";
import { requireShopper } from "../context/storefront.guard.js";
import { WebOrdersService } from "../orders/web-orders.service.js";
import { moneyView } from "../pricing/money-view.js";
import { StorefrontPricing } from "../pricing/storefront-pricing.service.js";
import type {
  ListItemDto,
  ListNameDto,
  SaveAddressDto,
  TradeApplicationDto,
  UpdateAddressDto,
  UpdateProfileDto,
} from "./dto.js";
import { toCustomerView } from "./shopper-auth.service.js";

/**
 * The signed-in shopper's own records. Every method starts from
 * `requireShopper()` and filters by that account — RLS keeps one shop's data
 * from another's, and this keeps one shopper's from the next.
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly carts: CartService,
    private readonly orders: WebOrdersService,
    private readonly pricing: StorefrontPricing,
  ) {}

  // ---------------------------------------------------------------------------
  // Profile
  // ---------------------------------------------------------------------------

  async updateProfile(dto: UpdateProfileDto) {
    const { accountId, customerId } = requireShopper();
    return this.db.run(async (tx) => {
      const [account] = await tx
        .update(schema.shopperAccounts)
        .set({ ...dto })
        .where(eq(schema.shopperAccounts.id, accountId))
        .returning();
      // The counter sees the same person: keep the customer record's contact in step.
      const customer = await tx
        .update(schema.customers)
        .set({
          name: `${account!.firstName} ${account!.lastName}`,
          ...(dto.phone ? { phone: dto.phone } : {}),
          ...(dto.companyName !== undefined ? { company: dto.companyName || null } : {}),
          ...(dto.trn ? { trn: dto.trn } : {}),
        })
        .where(eq(schema.customers.id, customerId))
        .returning({ type: schema.customers.type });
      return toCustomerView(account!, customer[0]?.type ?? "retail");
    });
  }

  /**
   * Ask for trade pricing. Recorded only: approval is a staff decision that
   * assigns the customer a price list in the admin panel — nothing a shopper
   * can grant themselves.
   */
  async applyForTrade(dto: TradeApplicationDto) {
    const { accountId } = requireShopper();
    return this.db.run(async (tx) => {
      const account = await tx.query.shopperAccounts.findFirst({ where: (t, { eq: e }) => e(t.id, accountId) });
      if (account?.tradeStatus === "approved") {
        throw new AppError(ERROR_CODES.CONFLICT, "Your trade account is already active.");
      }
      await tx
        .update(schema.shopperAccounts)
        .set({ companyName: dto.companyName, trn: dto.trn, tradeStatus: "pending", tradeNote: dto.message ?? null })
        .where(eq(schema.shopperAccounts.id, accountId));
      return { tradeStatus: "PENDING" as const };
    });
  }

  // ---------------------------------------------------------------------------
  // Addresses
  // ---------------------------------------------------------------------------

  async addresses() {
    const { accountId } = requireShopper();
    return this.db.run(async (tx) => {
      const rows = await tx.query.shopperAddresses.findMany({
        where: (t, { eq: e }) => e(t.accountId, accountId),
        orderBy: (t, { desc: d }) => [d(t.isDefault), d(t.updatedAt)],
      });
      return rows.map(toAddressView);
    });
  }

  async addAddress(dto: SaveAddressDto) {
    const { accountId } = requireShopper();
    return this.db.run(async (tx) => {
      const [existing] = await tx
        .select({ value: count() })
        .from(schema.shopperAddresses)
        .where(eq(schema.shopperAddresses.accountId, accountId));
      const isDefault = dto.isDefault ?? (existing?.value ?? 0) === 0;
      if (isDefault) await this.clearDefault(tx, accountId);
      const [row] = await tx
        .insert(schema.shopperAddresses)
        .values({ tenantId: RequestContext.requireTenantId(), accountId, ...newAddressValues(dto), isDefault })
        .returning();
      return toAddressView(row!);
    });
  }

  async updateAddress(id: string, dto: UpdateAddressDto) {
    const { accountId } = requireShopper();
    return this.db.run(async (tx) => {
      await this.ownedAddress(tx, accountId, id);
      if (dto.isDefault) await this.clearDefault(tx, accountId);
      const [row] = await tx
        .update(schema.shopperAddresses)
        .set({ ...addressValues(dto), ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}) })
        .where(eq(schema.shopperAddresses.id, id))
        .returning();
      return toAddressView(row!);
    });
  }

  async deleteAddress(id: string) {
    const { accountId } = requireShopper();
    await this.db.run(async (tx) => {
      const address = await this.ownedAddress(tx, accountId, id);
      await tx.delete(schema.shopperAddresses).where(eq(schema.shopperAddresses.id, id));
      if (!address.isDefault) return;
      // Keep one default: promote the most recently used remaining address.
      const next = await tx.query.shopperAddresses.findFirst({
        where: (t, { eq: e }) => e(t.accountId, accountId),
        orderBy: (t, { desc: d }) => d(t.updatedAt),
      });
      if (next) await tx.update(schema.shopperAddresses).set({ isDefault: true }).where(eq(schema.shopperAddresses.id, next.id));
    });
    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Orders
  // ---------------------------------------------------------------------------

  async orderList(page: number) {
    return this.orders.listForAccount(requireShopper().accountId, page);
  }

  async order(id: string) {
    return this.orders.forAccount(requireShopper().accountId, id);
  }

  /** Every still-available line of a past order, back into the cart at today's price. */
  async reorder(id: string) {
    const order = await this.order(id);
    return this.addAllToCart(order.lines.map((l) => ({ variantId: l.variantId, uom: l.uom, quantity: l.quantity, sku: l.sku })));
  }

  // ---------------------------------------------------------------------------
  // Lists & wishlist
  // ---------------------------------------------------------------------------

  async lists() {
    const { accountId } = requireShopper();
    return this.db.run(async (tx) => {
      const lists = await tx.query.shopperLists.findMany({
        where: (t, { eq: e }) => e(t.accountId, accountId),
        orderBy: (t, { desc: d }) => [d(t.isWishlist), d(t.updatedAt)],
      });
      const counts = lists.length
        ? await tx
            .select({ listId: schema.shopperListItems.listId, value: count() })
            .from(schema.shopperListItems)
            .where(inArray(schema.shopperListItems.listId, lists.map((l) => l.id)))
            .groupBy(schema.shopperListItems.listId)
        : [];
      const countBy = new Map(counts.map((c) => [c.listId, c.value]));
      return lists.map((l) => ({ id: l.id, name: l.name, isWishlist: l.isWishlist, itemCount: countBy.get(l.id) ?? 0, updatedAt: l.updatedAt }));
    });
  }

  async list(id: string) {
    const { accountId, customerId } = requireShopper();
    return this.db.run(async (tx) => {
      const list = await this.ownedList(tx, accountId, id);
      const items = await tx
        .select({
          id: schema.shopperListItems.id,
          variantId: schema.shopperListItems.variantId,
          unitId: schema.shopperListItems.unitId,
          quantity: schema.shopperListItems.quantity,
          sku: schema.productVariants.sku,
          variantName: schema.productVariants.variantName,
          variantActive: schema.productVariants.isActive,
          productName: schema.products.name,
          productActive: schema.products.isActive,
          baseUnitId: schema.products.unitId,
          taxRate: schema.products.taxRate,
          image: schema.products.imageUrl,
          slug: schema.productListings.slug,
          published: schema.productListings.isPublished,
          uom: schema.units.abbreviation,
        })
        .from(schema.shopperListItems)
        .innerJoin(schema.productVariants, eq(schema.shopperListItems.variantId, schema.productVariants.id))
        .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
        .innerJoin(schema.units, eq(schema.units.id, schema.shopperListItems.unitId))
        .leftJoin(schema.productListings, eq(schema.productListings.productId, schema.products.id))
        .where(eq(schema.shopperListItems.listId, list.id))
        .orderBy(schema.shopperListItems.createdAt);

      const packagings = items.length
        ? await tx.select().from(schema.variantUnits).where(inArray(schema.variantUnits.variantId, items.map((i) => i.variantId)))
        : [];
      const packagingBy = new Map(packagings.map((p) => [`${p.variantId}:${p.unitId}`, p]));
      const sellable = (i: (typeof items)[number]) =>
        i.variantActive && i.productActive && i.published === true &&
        (i.unitId === i.baseUnitId || packagingBy.get(`${i.variantId}:${i.unitId}`)?.isSellable === true);

      const priced = await this.pricing.priceLines(
        tx,
        items.filter(sellable).map((i) => {
          const packaging = packagingBy.get(`${i.variantId}:${i.unitId}`);
          return {
            variantId: i.variantId,
            unitId: i.unitId,
            quantity: i.quantity,
            taxRate: i.taxRate,
            packaging: {
              unitId: i.unitId,
              uom: i.uom,
              conversionFactor: packaging?.conversionFactor ?? "1",
              priceOverride: packaging?.priceOverride ?? null,
            },
          };
        }),
        customerId,
      );
      const { tenantSettings } = RequestContext.requireStorefront();
      const money = (minor: bigint) => moneyView(minor, tenantSettings.currency.base, tenantSettings.currency.decimals);
      const gross = (unitPrice: string, taxPercent: string, quantity: string) =>
        calculateLine({ quantity, unitPrice, taxPercent }, tenantSettings.tax.mode, tenantSettings.currency.decimals).total;

      let cursor = 0;
      return {
        id: list.id,
        name: list.name,
        isWishlist: list.isWishlist,
        items: items.map((i) => {
          const price = sellable(i) ? priced[cursor++] : null;
          return {
            id: i.id,
            variantId: i.variantId,
            sku: i.sku,
            productSlug: i.slug ?? "",
            productName: i.productName,
            variantName: i.variantName,
            imageUrl: i.image,
            uom: i.uom,
            quantity: Number(i.quantity),
            available: !!price,
            unitPrice: price ? money(gross(price.unitPrice, price.taxPercent, "1")) : null,
            lineTotal: price ? money(gross(price.unitPrice, price.taxPercent, i.quantity)) : null,
          };
        }),
      };
    });
  }

  async createList(dto: ListNameDto) {
    const { accountId } = requireShopper();
    return this.db.run(async (tx) => {
      const [list] = await tx
        .insert(schema.shopperLists)
        .values({ tenantId: RequestContext.requireTenantId(), accountId, name: dto.name })
        .returning();
      return list;
    });
  }

  async renameList(id: string, dto: ListNameDto) {
    const { accountId } = requireShopper();
    return this.db.run(async (tx) => {
      await this.ownedList(tx, accountId, id);
      const [list] = await tx.update(schema.shopperLists).set({ name: dto.name }).where(eq(schema.shopperLists.id, id)).returning();
      return list;
    });
  }

  async deleteList(id: string) {
    const { accountId } = requireShopper();
    await this.db.run(async (tx) => {
      const list = await this.ownedList(tx, accountId, id);
      if (list.isWishlist) throw new AppError(ERROR_CODES.VALIDATION_FAILED, "The wishlist cannot be deleted.");
      await tx.delete(schema.shopperLists).where(eq(schema.shopperLists.id, id));
    });
    return { deleted: true };
  }

  /** `listId` may be the literal "wishlist", created on first use. */
  async addToList(listId: string, dto: ListItemDto) {
    const { accountId } = requireShopper();
    const id = await this.db.run(async (tx) => {
      const list = listId === "wishlist" ? await this.wishlist(tx, accountId) : await this.ownedList(tx, accountId, listId);
      const unitId = await this.unitIdFor(tx, dto.variantId, dto.uom);
      await tx
        .insert(schema.shopperListItems)
        .values({
          tenantId: RequestContext.requireTenantId(),
          listId: list.id,
          variantId: dto.variantId,
          unitId,
          quantity: String(dto.quantity ?? 1),
        })
        .onConflictDoUpdate({
          target: [schema.shopperListItems.listId, schema.shopperListItems.variantId, schema.shopperListItems.unitId],
          set: { quantity: String(dto.quantity ?? 1), updatedAt: new Date() },
        });
      await tx.update(schema.shopperLists).set({ updatedAt: new Date() }).where(eq(schema.shopperLists.id, list.id));
      return list.id;
    });
    return this.list(id);
  }

  async removeFromList(listId: string, itemId: string) {
    const { accountId } = requireShopper();
    await this.db.run(async (tx) => {
      await this.ownedList(tx, accountId, listId);
      await tx
        .delete(schema.shopperListItems)
        .where(and(eq(schema.shopperListItems.id, itemId), eq(schema.shopperListItems.listId, listId)));
    });
    return this.list(listId);
  }

  async listToCart(listId: string) {
    const list = await this.list(listId);
    return this.addAllToCart(list.items.map((i) => ({ variantId: i.variantId, uom: i.uom, quantity: i.quantity, sku: i.sku })));
  }

  // ---------------------------------------------------------------------------

  /** One line at a time, so a line that can no longer be bought is skipped rather than failing the rest. */
  private async addAllToCart(lines: { variantId: string; uom: string; quantity: number; sku: string }[]) {
    const added: string[] = [];
    const skipped: string[] = [];
    for (const line of lines) {
      try {
        await this.carts.addItem(undefined, { variantId: line.variantId, uom: line.uom, quantity: line.quantity });
        added.push(line.sku);
      } catch {
        skipped.push(line.sku);
      }
    }
    return { added, skipped };
  }

  private async unitIdFor(tx: Transaction, variantId: string, uom?: string): Promise<string> {
    const variant = await tx.query.productVariants.findFirst({
      where: (t, { eq: e }) => e(t.id, variantId),
      with: { product: { with: { unit: true } }, packagings: { with: { unit: true } } },
    });
    if (!variant) throw new AppError(ERROR_CODES.PRODUCT_NOT_FOUND, "That product does not exist.");
    if (!uom || variant.product.unit.abbreviation.toLowerCase() === uom.toLowerCase()) return variant.product.unitId;
    const packaging = variant.packagings.find((p) => p.unit.abbreviation.toLowerCase() === uom.toLowerCase());
    if (!packaging) throw new AppError(ERROR_CODES.VALIDATION_FAILED, `${variant.product.name} is not sold per ${uom}.`);
    return packaging.unitId;
  }

  private async wishlist(tx: Transaction, accountId: string) {
    const existing = await tx.query.shopperLists.findFirst({
      where: (t, { and: a, eq: e }) => a(e(t.accountId, accountId), e(t.isWishlist, true)),
    });
    if (existing) return existing;
    const [created] = await tx
      .insert(schema.shopperLists)
      .values({ tenantId: RequestContext.requireTenantId(), accountId, name: "Wishlist", isWishlist: true })
      .returning();
    return created!;
  }

  private async ownedList(tx: Transaction, accountId: string, id: string) {
    const list = await tx.query.shopperLists.findFirst({
      where: (t, { and: a, eq: e }) => a(e(t.id, id), e(t.accountId, accountId)),
    });
    if (!list) throw new AppError(ERROR_CODES.NOT_FOUND, "That list was not found.");
    return list;
  }

  private async ownedAddress(tx: Transaction, accountId: string, id: string) {
    const address = await tx.query.shopperAddresses.findFirst({
      where: (t, { and: a, eq: e }) => a(e(t.id, id), e(t.accountId, accountId)),
    });
    if (!address) throw new AppError(ERROR_CODES.NOT_FOUND, "That address was not found.");
    return address;
  }

  private async clearDefault(tx: Transaction, accountId: string) {
    await tx.update(schema.shopperAddresses).set({ isDefault: false }).where(eq(schema.shopperAddresses.accountId, accountId));
  }
}

function newAddressValues(dto: SaveAddressDto) {
  return {
    label: dto.label ?? null,
    fullName: dto.fullName,
    phone: dto.phone,
    emirate: dto.emirate,
    area: dto.area,
    street: dto.street,
    building: dto.building ?? null,
    landmark: dto.landmark ?? null,
    lat: dto.lat !== undefined ? String(dto.lat) : null,
    lng: dto.lng !== undefined ? String(dto.lng) : null,
  };
}

function addressValues(dto: UpdateAddressDto) {
  const { isDefault: _isDefault, lat, lng, ...rest } = dto;
  return {
    ...rest,
    ...(lat !== undefined ? { lat: String(lat) } : {}),
    ...(lng !== undefined ? { lng: String(lng) } : {}),
  };
}

function toAddressView(a: typeof schema.shopperAddresses.$inferSelect) {
  return {
    id: a.id,
    customerId: a.accountId,
    label: a.label,
    fullName: a.fullName,
    phone: a.phone,
    emirate: a.emirate,
    area: a.area,
    street: a.street,
    building: a.building,
    landmark: a.landmark,
    lat: a.lat ? Number(a.lat) : null,
    lng: a.lng ? Number(a.lng) : null,
    isDefault: a.isDefault,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

