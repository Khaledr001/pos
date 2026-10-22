import { schema, sql, type Transaction } from "@devsfleet/db";
import { resolveTenantSettings } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { branchScope } from "../../common/context/branch-scope.js";
import { RequestContext } from "../../common/context/request-context.js";
import type { Env } from "../../config/env.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { CustomersService } from "./customers.service.js";
import type { ShareStatementDto } from "./dto.js";
import {
  createStatementLinkToken,
  readStatementLinkToken,
  statementLinkKey,
} from "./statement-link.js";
import { renderStatementPdf, type StatementPdfEntry } from "./statement-pdf.js";
import { ledgerQuery } from "./statement.js";

/** A statement past this many rows is a request for a shorter period, not a PDF. */
const MAX_ENTRIES = 10_000;

interface PeriodLedger {
  openingBalance: string;
  closingBalance: string;
  entries: StatementPdfEntry[];
}

/**
 * Statements handed to a customer as a link.
 *
 * The staff member makes the link here and sends it themselves — from their
 * own WhatsApp or mail app — so nothing has to be configured for it to work.
 * The link is a signed token (see statement-link.ts), checked statelessly
 * when the customer opens it; there is nothing to revoke, which is why links
 * expire within a month at most.
 */
@Injectable()
export class StatementShareService {
  private readonly key: Buffer;

  constructor(
    private readonly db: TenantDatabase,
    private readonly customers: CustomersService,
    config: ConfigService<Env, true>,
  ) {
    this.key = statementLinkKey(config.get("JWT_ACCESS_SECRET", { infer: true }));
  }

  async share(customerId: string, dto: ShareStatementDto) {
    const user = RequestContext.get()?.user;
    if (!user?.tenantId) {
      throw new AppError(ERROR_CODES.INSUFFICIENT_PERMISSIONS, "Sharing a statement needs a business session");
    }
    // The same existence and access check the statement tab gets.
    const customer = await this.customers.findById(customerId);
    const scope = branchScope();
    const expiresAt = new Date(Date.now() + dto.expiresInDays * 86_400_000);

    // Worked out now as well as when the link is opened: the closing balance
    // goes into the message the staff member sends, and a period too long to
    // print is better refused here than discovered by the customer.
    const ledger = await this.db.run(async (tx) => {
      const settings = await this.settings(tx);
      return this.periodLedger(tx, customerId, scope, dto.from ?? null, dto.to ?? null, settings.locale.timezone);
    });

    if (ledger.entries.length > MAX_ENTRIES) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        `This period has ${ledger.entries.length.toLocaleString()} entries. Choose a shorter period.`,
      );
    }

    const token = createStatementLinkToken(this.key, {
      tenantId: user.tenantId,
      customerId,
      from: dto.from ?? null,
      to: dto.to ?? null,
      expiresAt,
      branchIds: scope,
    });

    // Written here rather than by @Audited: the trail needs the expiry and the
    // period, and the interceptor records only who touched which record.
    const store = RequestContext.get();
    await this.db.run(async (tx) => {
      await tx.insert(schema.auditLog).values({
        tenantId: user.tenantId!,
        branchId: store?.branchId ?? user.branchId ?? null,
        userId: user.id,
        entityType: "customer",
        entityId: customer.id,
        action: "share-statement",
        changes: {
          period: [null, `${dto.from ?? "start"}..${dto.to ?? "now"}`],
          expiresAt: [null, expiresAt.toISOString()],
        },
        reason: `Statement link for ${customer.name}, valid until ${expiresAt.toISOString().slice(0, 10)}`,
        ...(store?.ipAddress ? { ipAddress: store.ipAddress } : {}),
        requestId: RequestContext.requestId,
        impersonatedBy: user.impersonatedBy ?? null,
      });
    });

    return {
      token,
      /**
       * Relative to the API's base URL. The admin panel joins it to the base it
       * already talks to — on a server behind a proxy, that is the address the
       * customer can actually reach, which this process cannot know for sure.
       */
      path: `/public/statements/${token}`,
      expiresAt: expiresAt.toISOString(),
      closingBalance: ledger.closingBalance,
      entryCount: ledger.entries.length,
    };
  }

  /**
   * The customer opening their link. No session: the token is the authority,
   * and it names the tenant, so the read runs as that tenant under RLS.
   *
   * Every failure that is not "genuine but expired" is the same 404 — a
   * forged token, a deleted customer, a tenant that no longer exists — so the
   * endpoint cannot be used to learn which customers exist.
   */
  async open(token: string): Promise<{ filename: string; body: Buffer }> {
    const check = readStatementLinkToken(this.key, token);
    if (!check.ok) {
      if (check.reason === "expired") {
        throw new AppError(ERROR_CODES.LINK_EXPIRED, "This statement link has expired. Ask for a new one.");
      }
      throw new AppError(ERROR_CODES.NOT_FOUND, "Statement not found");
    }
    const { tenantId, customerId, from, to, branchIds } = check.claims;

    const data = await this.db.runAs(tenantId, async (tx) => {
      const [tenant, customer] = await Promise.all([
        tx.query.tenants.findFirst({ columns: { name: true, settings: true, isActive: true } }),
        tx.query.customers.findFirst({
          where: (t, { and: a, eq: e, isNull: n }) => a(e(t.id, customerId), n(t.deletedAt)),
        }),
      ]);
      if (!tenant?.isActive || !customer) return null;
      const settings = resolveTenantSettings(tenant.settings);
      const ledger = await this.periodLedger(tx, customerId, branchIds, from, to, settings.locale.timezone);
      return { tenant, settings, customer, ledger };
    });
    if (!data) throw new AppError(ERROR_CODES.NOT_FOUND, "Statement not found");

    const { tenant, settings, customer, ledger } = data;
    const issuedAt = new Date();
    const body = await renderStatementPdf({
      business: {
        legalName: settings.legalName ?? tenant.name,
        trn: settings.trn ?? null,
        phone: settings.phone ?? null,
        email: settings.email ?? null,
        addressLines: settings.addressLines ?? [],
      },
      currency: settings.currency.base,
      timezone: settings.locale.timezone,
      issuedAt,
      from,
      to,
      customer: {
        name: customer.name,
        company: customer.company,
        phone: customer.phone,
        trn: customer.trn,
      },
      openingBalance: ledger.openingBalance,
      closingBalance: ledger.closingBalance,
      creditLimit: customer.creditLimit,
      entries: ledger.entries,
    });

    const slug = customer.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "customer";
    const period = `${from ?? "start"}_${to ?? issuedAt.toISOString().slice(0, 10)}`;
    return { filename: `statement_${slug}_${period}.pdf`, body };
  }

  private async settings(tx: Transaction) {
    const tenant = await tx.query.tenants.findFirst({ columns: { settings: true } });
    return resolveTenantSettings(tenant?.settings);
  }

  /**
   * The ledger rows inside the period, oldest first, each with its running
   * balance over the WHOLE ledger — so the first row continues from the
   * balance brought forward, not from zero. Dates are compared in the
   * business's own timezone: a sale at 01:00 on the 1st, Dubai time, belongs
   * to that month, not the one before it in UTC.
   */
  private async periodLedger(
    tx: Transaction,
    customerId: string,
    branchIds: string[] | null,
    from: string | null,
    to: string | null,
    timezone: string,
  ): Promise<PeriodLedger> {
    const ledger = ledgerQuery(customerId, branchIds);
    const day = sql`(date at time zone ${timezone})::date`;
    const afterFrom = from ? sql`${day} >= ${from}::date` : sql`true`;
    const beforeTo = to ? sql`${day} <= ${to}::date` : sql`true`;
    const beforeFrom = from ? sql`${day} < ${from}::date` : sql`false`;

    const rows = (await tx.execute(sql`
      with ledger as (${ledger}),
      running as (
        select ledger.*,
          sum(debit - credit) over (
            order by date asc, id asc rows between unbounded preceding and current row
          ) as balance
        from ledger
      )
      select id, kind, date, doc_number as "docNumber", branch_name as "branchName", method,
        debit::text as debit, credit::text as credit, balance::text as balance
      from running
      where ${afterFrom} and ${beforeTo}
      order by date asc, id asc
    `)) as unknown as Array<{
      id: string;
      kind: StatementPdfEntry["kind"];
      date: string | Date;
      docNumber: string | null;
      branchName: string | null;
      method: string | null;
      debit: string;
      credit: string;
      balance: string;
    }>;

    const [totals] = (await tx.execute(sql`
      with ledger as (${ledger})
      select
        coalesce(sum(debit - credit) filter (where ${beforeFrom}), 0)::text as opening,
        coalesce(sum(debit - credit) filter (where ${beforeTo}), 0)::text as closing
      from ledger
    `)) as unknown as Array<{ opening: string; closing: string }>;

    return {
      openingBalance: totals?.opening ?? "0",
      closingBalance: totals?.closing ?? "0",
      entries: rows.map((r) => ({
        date: r.date instanceof Date ? r.date : new Date(r.date),
        kind: r.kind,
        docNumber: r.docNumber,
        branchName: r.branchName,
        method: r.method,
        debit: r.debit,
        credit: r.credit,
        balance: r.balance,
      })),
    };
  }
}
