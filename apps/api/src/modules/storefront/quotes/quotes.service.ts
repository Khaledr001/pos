import { and, count, desc, eq, inArray, schema, sql, type Transaction } from "@devsfleet/db";
import { AppError, ERROR_CODES, formatDocumentNumber, Money, sequenceKey } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../../common/context/request-context.js";
import { TenantDatabase } from "../../../database/tenant-database.service.js";
import { CartService } from "../cart/cart.service.js";
import { requireShopper } from "../context/storefront.guard.js";
import { StorefrontPricing } from "../pricing/storefront-pricing.service.js";
import type { CreateQuoteDto } from "./dto.js";
import { quoteTotals } from "./quote-math.js";
import { assertShopperMayRespond } from "./quote-status.js";
import { displayDecimals, shopperQuoteSummary, shopperQuoteView } from "./quote-view.js";

const PAGE_SIZE = 20;
/** Marks the web channel's own run in the quotation sequence, apart from each branch's counter. */
const WEB_SEQUENCE = "WEB";

/**
 * A trade buyer's requests for a price.
 *
 * The shopper supplies WHAT they want and never WHAT IT COSTS: lines are priced
 * here, from the same ladder as the cart, and snapshotted (rule 5). The prices
 * that matter — the ones the shopper can accept — are set by staff on
 * `quoted_unit_price`, a column no shopper-facing route writes.
 *
 * Accepting records the shopper's answer and nothing else. It deliberately does
 * not place an order: an order reserves stock and takes payment, both of which
 * the checkout owns, and the cart cannot hold a negotiated price. Staff turn an
 * accepted quote into an order from the order desk.
 */
@Injectable()
export class QuotesService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly carts: CartService,
    private readonly pricing: StorefrontPricing,
  ) {}

  async create(guestCartId: string | undefined, dto: CreateQuoteDto) {
    const shopper = requireShopper();
    return this.db.run(async (tx) => {
      // A retry of a submission that already went through: the same answer again.
      const prior = await tx.query.webQuotes.findFirst({ where: (t, { eq: e }) => e(t.clientId, dto.clientId) });
      if (prior) return this.forShopper(tx, prior, shopper.accountId);

      const wanted = dto.lines
        ? dto.lines.map((l) => ({ variantId: l.variantId, uom: l.uom, unitId: undefined, quantity: String(l.quantity) }))
        : await this.cartLines(tx, guestCartId);
      if (wanted.length === 0) throw new AppError(ERROR_CODES.CART_EMPTY, "Add something to your cart before asking for a quote.");

      const { tenantSettings } = RequestContext.requireStorefront();
      const taxMode = tenantSettings.tax.mode;
      const decimals = tenantSettings.currency.decimals;
      const lines = await this.snapshot(tx, wanted, shopper.customerId);
      const totals = quoteTotals(lines, taxMode, decimals);

      const tenantId = RequestContext.requireTenantId();
      const [created] = await tx
        .insert(schema.webQuotes)
        .values({
          tenantId,
          number: await this.nextNumber(tx),
          accountId: shopper.accountId,
          clientId: dto.clientId,
          contactName: dto.contact.fullName,
          contactEmail: dto.contact.email,
          contactPhone: dto.contact.phone,
          companyName: dto.companyName ?? null,
          notes: dto.notes ?? null,
          currency: tenantSettings.currency.base,
          taxMode,
          ...totals,
        })
        .onConflictDoNothing({ target: [schema.webQuotes.tenantId, schema.webQuotes.clientId] })
        .returning();
      if (!created) {
        // Lost a race with the same submission in another request.
        const winner = await tx.query.webQuotes.findFirst({ where: (t, { eq: e }) => e(t.clientId, dto.clientId) });
        if (!winner) throw new AppError(ERROR_CODES.CONFLICT, "Could not save your quote request. Please try again.");
        return this.forShopper(tx, winner, shopper.accountId);
      }

      await tx.insert(schema.webQuoteItems).values(
        lines.map((line, index) => ({
          tenantId,
          quoteId: created.id,
          variantId: line.variantId,
          unitId: line.unitId,
          sortOrder: index,
          productName: line.productName,
          variantName: line.variantName,
          productSku: line.sku,
          uom: line.uom,
          taxPercent: line.taxPercent,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        })),
      );
      return this.forShopper(tx, created, shopper.accountId);
    });
  }

  async list(page: number) {
    const { accountId } = requireShopper();
    return this.db.run(async (tx) => {
      const where = eq(schema.webQuotes.accountId, accountId);
      const [total] = await tx.select({ value: count() }).from(schema.webQuotes).where(where);
      const rows = await tx
        .select()
        .from(schema.webQuotes)
        .where(where)
        .orderBy(desc(schema.webQuotes.createdAt))
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE);
      const counts = rows.length
        ? await tx
            .select({ quoteId: schema.webQuoteItems.quoteId, value: count() })
            .from(schema.webQuoteItems)
            .where(inArray(schema.webQuoteItems.quoteId, rows.map((r) => r.id)))
            .groupBy(schema.webQuoteItems.quoteId)
        : [];
      const countBy = new Map(counts.map((c) => [c.quoteId, c.value]));
      const decimals = await displayDecimals(tx);
      return {
        items: rows.map((q) => shopperQuoteSummary(q, countBy.get(q.id) ?? 0, decimals)),
        total: total?.value ?? 0,
        page,
        pageSize: PAGE_SIZE,
      };
    });
  }

  async get(id: string) {
    const { accountId } = requireShopper();
    return this.db.run(async (tx) => this.forShopper(tx, await this.owned(tx, accountId, id), accountId));
  }

  accept(id: string) {
    return this.respond(id, "accepted");
  }

  decline(id: string) {
    return this.respond(id, "declined");
  }

  // ---------------------------------------------------------------------------

  /**
   * The answer is one conditional update — still quoted, still in date — so
   * accepting twice, or accepting while staff withdraw the quote, resolves to
   * exactly one outcome. Checking first and writing after would let both win.
   */
  private async respond(id: string, to: "accepted" | "declined") {
    const { accountId } = requireShopper();
    const outcome = await this.db.run(async (tx) => {
      const quote = await this.owned(tx, accountId, id);
      assertShopperMayRespond(quote.status, quote.validUntil, new Date());

      const [updated] = await tx
        .update(schema.webQuotes)
        .set({ status: to, respondedAt: new Date() })
        .where(
          and(
            eq(schema.webQuotes.id, id),
            eq(schema.webQuotes.accountId, accountId),
            eq(schema.webQuotes.status, "quoted"),
            sql`${schema.webQuotes.validUntil} > now()`,
          ),
        )
        .returning();
      if (!updated) {
        // Changed under us between the read and the write: report what it is now.
        const fresh = await this.owned(tx, accountId, id);
        assertShopperMayRespond(fresh.status, fresh.validUntil, new Date());
        throw new AppError(ERROR_CODES.CONFLICT, "This quote just changed. Reload and try again.");
      }
      return this.forShopper(tx, updated, accountId);
    });
    return outcome;
  }

  private async cartLines(tx: Transaction, guestCartId: string | undefined) {
    const cart = await this.carts.find(tx, guestCartId);
    if (!cart) return [];
    const priced = await this.carts.price(tx, cart);
    return priced.lines
      .filter((l) => l.priced)
      .map((l) => ({ variantId: l.variantId, uom: undefined, unitId: l.unitId as string | undefined, quantity: l.quantity }));
  }

  /**
   * Resolve each requested line to a sellable unit, merge repeats, and price
   * them for this customer — their trade list if they have one — so the
   * estimate matches what the cart would charge.
   */
  private async snapshot(
    tx: Transaction,
    wanted: { variantId: string; uom: string | undefined; unitId: string | undefined; quantity: string }[],
    customerId: string,
  ) {
    const merged = new Map<string, { variantId: string; unit: Awaited<ReturnType<CartService["unitFor"]>>; quantity: bigint }>();
    for (const line of wanted) {
      const unit = await this.carts.unitFor(tx, line.variantId, line.uom, line.unitId);
      const quantity = Money.toMinor(line.quantity);
      if (!Money.isPositive(quantity)) throw new AppError(ERROR_CODES.VALIDATION_FAILED, "That quantity is not valid.");
      if (!unit.allowsFractions && Money.roundTo(quantity, 0) !== quantity) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, "This item is sold in whole units only.");
      }
      const key = `${line.variantId}:${unit.unitId}`;
      const existing = merged.get(key);
      merged.set(key, { variantId: line.variantId, unit, quantity: (existing?.quantity ?? 0n) + quantity });
    }

    const entries = [...merged.values()];
    const priced = await this.pricing.priceLines(
      tx,
      entries.map((e) => ({
        variantId: e.variantId,
        unitId: e.unit.unitId,
        quantity: Money.toDecimalString(e.quantity, 4),
        taxRate: e.unit.taxRate,
        packaging: e.unit.packaging,
      })),
      customerId,
    );
    const variants = await tx.query.productVariants.findMany({
      where: (t, { inArray: inList }) => inList(t.id, entries.map((e) => e.variantId)),
      with: { product: { columns: { name: true } } },
    });
    const variantBy = new Map(variants.map((v) => [v.id, v]));

    return entries.map((entry, index) => {
      const price = priced[index];
      const variant = variantBy.get(entry.variantId);
      if (!price || !variant) throw new AppError(ERROR_CODES.NO_PRICE_FOR_PRODUCT, "An item in this request cannot be quoted online right now.");
      return {
        variantId: entry.variantId,
        unitId: entry.unit.unitId,
        productName: variant.product.name,
        variantName: variant.variantName,
        sku: variant.sku,
        uom: entry.unit.packaging.uom,
        taxPercent: price.taxPercent,
        quantity: Money.toDecimalString(entry.quantity, 4),
        unitPrice: price.unitPrice,
      };
    });
  }

  private async owned(tx: Transaction, accountId: string, id: string) {
    const quote = await tx.query.webQuotes.findFirst({
      where: (t, { and: a, eq: e }) => a(e(t.id, id), e(t.accountId, accountId)),
    });
    // The same answer for "not yours" as for "does not exist".
    if (!quote) throw new AppError(ERROR_CODES.NOT_FOUND, "We could not find that quote.");
    return quote;
  }

  private async forShopper(tx: Transaction, quote: typeof schema.webQuotes.$inferSelect, accountId: string) {
    if (quote.accountId !== accountId) throw new AppError(ERROR_CODES.CONFLICT, "That request id was already used.");
    const items = await tx.query.webQuoteItems.findMany({ where: (t, { eq: e }) => e(t.quoteId, quote.id) });
    return shopperQuoteView(quote, items, await displayDecimals(tx));
  }

  /** QT-WEB-2026-000012. The web channel counts apart from every branch's own quotation counter. */
  private async nextNumber(tx: Transaction): Promise<string> {
    const tenantId = RequestContext.requireTenantId();
    const year = new Date().getFullYear();
    const [seq] = await tx.execute<{ next_document_number: number }>(
      sql`SELECT next_document_number(${tenantId}::uuid, ${sequenceKey("quotation", year, WEB_SEQUENCE)})`,
    );
    return formatDocumentNumber({
      kind: "quotation",
      year,
      sequence: Number((seq as { next_document_number?: number } | undefined)?.next_document_number ?? 1),
      branchCode: WEB_SEQUENCE,
    });
  }
}
