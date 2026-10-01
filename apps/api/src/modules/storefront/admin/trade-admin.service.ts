import { desc, eq, ne, schema } from "@devsfleet/db";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { TenantDatabase } from "../../../database/tenant-database.service.js";
import { toWire } from "../wire.js";
import type { ApproveTradeDto, RejectTradeDto } from "./dto.js";

/**
 * Trade (contractor) applications from the website.
 *
 * Approving one is a pricing decision: it puts the customer on a price list.
 * It is the same edit as setting a price list on the customer's record, so
 * it needs the same permission — and the shopper sees their trade prices on
 * their next page load, from the same PriceResolverService the till uses.
 */
@Injectable()
export class TradeAdminService {
  constructor(private readonly db: TenantDatabase) {}

  async list() {
    return this.db.run(async (tx) => {
      const rows = await tx
        .select({
          accountId: schema.shopperAccounts.id,
          customerId: schema.shopperAccounts.customerId,
          email: schema.shopperAccounts.email,
          firstName: schema.shopperAccounts.firstName,
          lastName: schema.shopperAccounts.lastName,
          phone: schema.shopperAccounts.phone,
          companyName: schema.shopperAccounts.companyName,
          trn: schema.shopperAccounts.trn,
          tradeStatus: schema.shopperAccounts.tradeStatus,
          tradeNote: schema.shopperAccounts.tradeNote,
          updatedAt: schema.shopperAccounts.updatedAt,
          customerType: schema.customers.type,
          priceListId: schema.customers.priceListId,
        })
        .from(schema.shopperAccounts)
        .innerJoin(schema.customers, eq(schema.customers.id, schema.shopperAccounts.customerId))
        .where(ne(schema.shopperAccounts.tradeStatus, "none"))
        .orderBy(desc(schema.shopperAccounts.updatedAt));
      const priceLists = await tx.query.priceLists.findMany({
        where: (t, { eq: e }) => e(t.isActive, true),
        columns: { id: true, name: true, type: true, isDefault: true },
      });
      return { applications: rows.map((r) => ({ ...r, tradeStatus: toWire(r.tradeStatus) })), priceLists };
    });
  }

  async approve(accountId: string, dto: ApproveTradeDto) {
    await this.db.run(async (tx) => {
      const account = await tx.query.shopperAccounts.findFirst({ where: (t, { eq: e }) => e(t.id, accountId) });
      if (!account) throw new AppError(ERROR_CODES.NOT_FOUND, "That application does not exist.");
      const list = await tx.query.priceLists.findFirst({
        where: (t, { and: a, eq: e }) => a(e(t.id, dto.priceListId), e(t.isActive, true)),
        columns: { id: true },
      });
      if (!list) throw new AppError(ERROR_CODES.VALIDATION_FAILED, "That price list does not exist.");

      await tx
        .update(schema.customers)
        .set({
          priceListId: dto.priceListId,
          type: dto.customerType,
          ...(account.companyName ? { company: account.companyName } : {}),
          ...(account.trn ? { trn: account.trn } : {}),
        })
        .where(eq(schema.customers.id, account.customerId));
      await tx.update(schema.shopperAccounts).set({ tradeStatus: "approved" }).where(eq(schema.shopperAccounts.id, accountId));
    });
    return this.list();
  }

  async reject(accountId: string, dto: RejectTradeDto) {
    await this.db.run((tx) =>
      tx
        .update(schema.shopperAccounts)
        .set({ tradeStatus: "rejected", ...(dto.note ? { tradeNote: dto.note } : {}) })
        .where(eq(schema.shopperAccounts.id, accountId)),
    );
    return this.list();
  }
}
