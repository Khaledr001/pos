import { and, count, desc, eq, ilike, or, schema, sql, type SQL, type Transaction } from "@devsfleet/db";
import { hasPermission, type TaxMode } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES, Money } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../../common/context/request-context.js";
import { TenantDatabase } from "../../../database/tenant-database.service.js";
import { toWire } from "../wire.js";
import type { CloseQuoteDto, ListQuotesDto, PriceQuoteDto } from "./dto.js";
import { quoteTotals, withinDiscountCeiling } from "./quote-math.js";
import { assertStaffMayClose, assertStaffMayPrice } from "./quote-status.js";
import { displayDecimals, staffQuoteView } from "./quote-view.js";

/**
 * The quote desk: staff pricing the requests the website collected.
 *
 * Pricing is a discount decision, so it is held to the till's own limits: a
 * line quoted below its list price, or a document-level percentage, needs
 * `sale:discount` and must stay within the staff member's discount ceiling.
 * Without that, `order:write` would let anyone with the order desk undercut
 * the price list on a document a customer then holds us to.
 */
@Injectable()
export class QuotesAdminService {
  constructor(private readonly db: TenantDatabase) {}

  async list(dto: ListQuotesDto) {
    return this.db.run(async (tx) => {
      const search = dto.q ? `%${dto.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
      const where = and(
        statusFilter(dto.status),
        search
          ? or(
              ilike(schema.webQuotes.number, search),
              ilike(schema.webQuotes.contactName, search),
              ilike(schema.webQuotes.contactEmail, search),
              ilike(schema.webQuotes.companyName, search),
            )
          : undefined,
      );
      const [total] = await tx.select({ value: count() }).from(schema.webQuotes).where(where);
      const rows = await tx
        .select()
        .from(schema.webQuotes)
        .where(where)
        .orderBy(desc(schema.webQuotes.createdAt))
        .limit(dto.pageSize)
        .offset((dto.page - 1) * dto.pageSize);
      const decimals = await displayDecimals(tx);
      const counts = await tx
        .select({ status: effectiveStatusSql, value: count() })
        .from(schema.webQuotes)
        .groupBy(effectiveStatusSql);

      const now = new Date();
      return {
        items: rows.map((q) => {
          const view = staffQuoteView(q, [], decimals, now);
          return {
            id: q.id,
            number: q.number,
            status: view.status,
            estimate: view.estimate,
            contactName: q.contactName,
            contactEmail: q.contactEmail,
            contactPhone: q.contactPhone,
            companyName: q.companyName,
            requestedAt: q.requestedAt,
            validUntil: q.validUntil,
            total: view.totals.total,
          };
        }),
        total: total?.value ?? 0,
        page: dto.page,
        pageSize: dto.pageSize,
        countsByStatus: Object.fromEntries(counts.map((c) => [toWire(c.status), c.value])),
      };
    });
  }

  async detail(id: string) {
    return this.db.run((tx) => this.load(tx, id));
  }

  async price(id: string, dto: PriceQuoteDto) {
    const user = RequestContext.requireUser();
    const validUntil = new Date(dto.validUntil);
    if (validUntil.getTime() <= Date.now()) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, "A quote must be valid until a date in the future.");
    }

    return this.db.run(async (tx) => {
      const quote = await this.require(tx, id);
      assertStaffMayPrice(quote.status);
      const items = await tx.query.webQuoteItems.findMany({ where: (t, { eq: e }) => e(t.quoteId, id) });

      const priceBy = new Map(dto.lines.map((l) => [l.itemId, l.unitPrice]));
      for (const itemId of priceBy.keys()) {
        if (!items.some((i) => i.id === itemId)) throw new AppError(ERROR_CODES.VALIDATION_FAILED, "A price was given for a line that is not on this quote.");
      }
      const priced = items.map((item) => ({ item, unitPrice: priceBy.get(item.id) ?? item.quotedUnitPrice }));
      const missing = priced.find((p) => p.unitPrice === null);
      if (missing) throw new AppError(ERROR_CODES.VALIDATION_FAILED, `Price ${missing.item.productSku} before sending the quote.`);

      this.assertDiscountAuthority(user, priced.map((p) => ({ sku: p.item.productSku, list: p.item.unitPrice, quoted: p.unitPrice! })), dto.discountPercent);

      const decimals = await displayDecimals(tx);
      const totals = quoteTotals(
        priced.map((p) => ({ quantity: p.item.quantity, unitPrice: p.unitPrice!, taxPercent: p.item.taxPercent })),
        quote.taxMode as TaxMode,
        decimals,
        dto.discountPercent,
      );

      for (const p of priced) {
        if (p.unitPrice === p.item.quotedUnitPrice) continue;
        await tx.update(schema.webQuoteItems).set({ quotedUnitPrice: p.unitPrice }).where(eq(schema.webQuoteItems.id, p.item.id));
      }
      await tx
        .update(schema.webQuotes)
        .set({
          status: "quoted",
          quotedAt: new Date(),
          quotedBy: user.id,
          validUntil,
          discountPercent: dto.discountPercent,
          ...totals,
          ...(dto.staffNotes !== undefined ? { staffNotes: dto.staffNotes } : {}),
        })
        .where(eq(schema.webQuotes.id, id));
      return this.load(tx, id);
    });
  }

  async close(id: string, dto: CloseQuoteDto) {
    return this.db.run(async (tx) => {
      const quote = await this.require(tx, id);
      assertStaffMayClose(quote.status, dto.status);
      const note = dto.note ? `${quote.staffNotes ? `${quote.staffNotes}\n` : ""}${dto.note}` : quote.staffNotes;
      await tx
        .update(schema.webQuotes)
        .set({
          status: dto.status,
          staffNotes: note,
          // Lapsing a quote ends its validity now, so the date on screen is true.
          ...(dto.status === "expired" ? { validUntil: new Date() } : {}),
        })
        .where(and(eq(schema.webQuotes.id, id), eq(schema.webQuotes.status, quote.status)));
      return this.load(tx, id);
    });
  }

  // ---------------------------------------------------------------------------

  private assertDiscountAuthority(
    user: ReturnType<typeof RequestContext.requireUser>,
    lines: { sku: string; list: string; quoted: string }[],
    documentDiscountPercent: string,
  ): void {
    const documentDiscount = Money.toMinor(documentDiscountPercent) > 0n;
    const undercuts = lines.some((l) => Money.toMinor(l.quoted) < Money.toMinor(l.list));
    if (!documentDiscount && !undercuts) return;

    if (!hasPermission(user.permissions, "sale:discount")) {
      throw new AppError(ERROR_CODES.INSUFFICIENT_PERMISSIONS, "Quoting below list price needs the discount permission.");
    }
    const ceiling = String(user.abac.maxDiscountPercent);
    const over = lines.find((l) => !withinDiscountCeiling(l.list, l.quoted, documentDiscountPercent, ceiling));
    if (over) {
      throw new AppError(
        ERROR_CODES.DISCOUNT_EXCEEDS_LIMIT,
        `You may discount up to ${ceiling}%. ${over.sku} is quoted further below list than that.`,
        { sku: over.sku, allowed: ceiling },
      );
    }
  }

  private async require(tx: Transaction, id: string) {
    const quote = await tx.query.webQuotes.findFirst({ where: (t, { eq: e }) => e(t.id, id) });
    if (!quote) throw new AppError(ERROR_CODES.NOT_FOUND, "That quote does not exist.");
    return quote;
  }

  private async load(tx: Transaction, id: string) {
    const quote = await this.require(tx, id);
    const items = await tx.query.webQuoteItems.findMany({ where: (t, { eq: e }) => e(t.quoteId, id) });
    return staffQuoteView(quote, items, await displayDecimals(tx));
  }
}

/** `quoted` past its date reads as `expired`, in SQL too, so filters and counts agree with the screen. */
const effectiveStatusSql = sql<string>`CASE WHEN ${schema.webQuotes.status} = 'quoted' AND ${schema.webQuotes.validUntil} <= now() THEN 'expired' ELSE ${schema.webQuotes.status} END`;

function statusFilter(status: ListQuotesDto["status"]): SQL | undefined {
  return status ? sql`${effectiveStatusSql} = ${status}` : undefined;
}
