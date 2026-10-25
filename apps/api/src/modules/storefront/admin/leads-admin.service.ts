import { and, desc, eq, schema, sql, type SQL } from "@devsfleet/db";
import { LEAD_STATUSES, resolveTenantSettings, type LeadPage, type LeadRow, type LeadStatus } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import type { Response } from "express";
import { exportFilename, sendExport, type ExportColumn, type ExportFormat } from "../../../common/http/send-export.js";
import { TenantDatabase } from "../../../database/tenant-database.service.js";
import type { LeadFiltersDto, ListLeadsDto, UpdateLeadDto } from "./forms.dto.js";

/** An export is a sheet for a person to open, not a data dump. */
const MAX_LEAD_EXPORT = 10_000;

type LeadRecord = typeof schema.storefrontLeads.$inferSelect;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

function view(lead: LeadRecord): LeadRow {
  return {
    id: lead.id,
    formSlug: lead.formSlug,
    formName: lead.formName,
    status: lead.status,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    answers: lead.answers,
    source: { path: lead.sourcePath, productName: lead.productName, productSku: lead.productSku },
    notes: lead.notes,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
  };
}

/** The leads inbox: what visitors sent through the site's forms, and what the team did about it. */
@Injectable()
export class LeadsAdminService {
  constructor(private readonly db: TenantDatabase) {}

  /** Form and search narrow the list AND the status counts; the status tab only narrows the list. */
  private scope(filters: LeadFiltersDto): SQL[] {
    const t = schema.storefrontLeads;
    const conditions: SQL[] = [];
    if (filters.form) conditions.push(eq(t.formSlug, filters.form));
    if (filters.q) {
      const like = `%${escapeLike(filters.q)}%`;
      // `answers::text` carries every question and answer, so a search for "chrome" finds a quantity note.
      conditions.push(sql`(${t.name} ILIKE ${like} OR ${t.email} ILIKE ${like} OR ${t.phone} ILIKE ${like} OR ${t.productName} ILIKE ${like} OR ${t.answers}::text ILIKE ${like})`);
    }
    return conditions;
  }

  async list(dto: ListLeadsDto): Promise<LeadPage> {
    const t = schema.storefrontLeads;
    const scope = this.scope(dto);
    const where = and(...scope, dto.status ? eq(t.status, dto.status) : undefined);
    return this.db.run(async (tx) => {
      const [items, [total], grouped] = await Promise.all([
        tx
          .select()
          .from(t)
          .where(where)
          .orderBy(desc(t.createdAt), desc(t.id))
          .limit(dto.pageSize)
          .offset((dto.page - 1) * dto.pageSize),
        tx.select({ n: sql<number>`count(*)::int` }).from(t).where(where),
        tx.select({ status: t.status, n: sql<number>`count(*)::int` }).from(t).where(and(...scope)).groupBy(t.status),
      ]);
      const counts = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<LeadStatus, number>;
      for (const row of grouped) counts[row.status] = Number(row.n);
      return { total: Number(total?.n ?? 0), page: dto.page, items: items.map(view), counts };
    });
  }

  async get(id: string): Promise<LeadRow> {
    return this.db.run(async (tx) => view(await this.require(tx, id)));
  }

  async update(id: string, dto: UpdateLeadDto): Promise<LeadRow> {
    return this.db.run(async (tx) => {
      await this.require(tx, id);
      const [lead] = await tx
        .update(schema.storefrontLeads)
        .set({ ...(dto.status !== undefined ? { status: dto.status } : {}), ...(dto.notes !== undefined ? { notes: dto.notes } : {}) })
        .where(eq(schema.storefrontLeads.id, id))
        .returning();
      return view(lead!);
    });
  }

  /** Leads are the business's to delete (a customer's request to be forgotten, a flood of spam). */
  async remove(id: string): Promise<{ deleted: true }> {
    return this.db.run(async (tx) => {
      await this.require(tx, id);
      await tx.delete(schema.storefrontLeads).where(eq(schema.storefrontLeads.id, id));
      return { deleted: true as const };
    });
  }

  /**
   * The current filters as a spreadsheet. Goes through the platform's shared
   * export writer, which neutralises cells a spreadsheet would run as a
   * formula (a visitor can type `=HYPERLINK(...)` into any field).
   */
  async export(filters: LeadFiltersDto, format: ExportFormat, res: Response): Promise<void> {
    const t = schema.storefrontLeads;
    const where = and(...this.scope(filters), filters.status ? eq(t.status, filters.status) : undefined);
    const { rows, timeZone } = await this.db.run(async (tx) => {
      const [tenant, rows] = await Promise.all([
        tx.query.tenants.findFirst({ columns: { settings: true } }),
        tx.select().from(t).where(where).orderBy(desc(t.createdAt)).limit(MAX_LEAD_EXPORT + 1),
      ]);
      return { rows, timeZone: resolveTenantSettings(tenant?.settings).locale.timezone };
    });
    if (rows.length > MAX_LEAD_EXPORT) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, `That export would have more than ${MAX_LEAD_EXPORT.toLocaleString("en")} leads. Filter by form or status first.`);
    }

    const columns: ExportColumn<LeadRecord>[] = [
      { header: "Received", kind: "datetime", value: (r) => r.createdAt },
      { header: "Form", value: (r) => r.formName },
      { header: "Status", value: (r) => r.status },
      { header: "Name", value: (r) => r.name },
      { header: "Email", value: (r) => r.email },
      { header: "Phone", value: (r) => r.phone },
      { header: "Product", value: (r) => r.productName },
      { header: "SKU", value: (r) => r.productSku },
      { header: "Page", value: (r) => r.sourcePath },
      { header: "Answers", width: 60, value: (r) => r.answers.map((a) => `${a.label}: ${a.value}`).join("\n") },
      { header: "Notes", width: 40, value: (r) => r.notes },
    ];
    await sendExport(res, {
      format,
      filename: exportFilename("leads", format),
      timeZone,
      sheets: [{ name: "Leads", columns, rows }],
    });
  }

  private async require(tx: Parameters<Parameters<TenantDatabase["run"]>[0]>[0], id: string) {
    const lead = await tx.query.storefrontLeads.findFirst({ where: (t, { eq: e }) => e(t.id, id) });
    if (!lead) throw new AppError(ERROR_CODES.NOT_FOUND, "That lead does not exist.");
    return lead;
  }
}
