import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import ExcelJS from "exceljs";
import type { Response } from "express";
import { z } from "zod";

/**
 * Period exports — CSV and Excel — for a handler that takes `@Res()`.
 *
 * Built for an accountant preparing a VAT return: every row the filter
 * matches, not the page on screen, with amounts as the exact decimals the
 * database holds and times on the business's own clock.
 */

export const ExportFormatSchema = z.enum(["csv", "xlsx"]).default("csv");
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

/**
 * Past this an export is refused rather than built: the whole file is held in
 * memory, and a year of every till in the business is a report, not a sheet.
 */
export const MAX_EXPORT_ROWS = 100_000;

export function assertExportSize(rows: number): void {
  if (rows > MAX_EXPORT_ROWS) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      `That export would have ${rows.toLocaleString("en")} rows; the limit is ${MAX_EXPORT_ROWS.toLocaleString("en")}. Narrow the date range.`,
    );
  }
}

/**
 * - `money`: a decimal string from SQL. Written to CSV exactly as stored
 *   (to two places); to Excel as a number, since Excel cannot sum text.
 * - `quantity`: the same, without fixing the places.
 * - `datetime` / `date`: a Date, shown on the business's clock.
 */
export type ExportKind = "text" | "money" | "quantity" | "datetime" | "date";

export interface ExportColumn<T> {
  header: string;
  kind?: ExportKind;
  value: (row: T) => string | number | Date | null | undefined;
  /** Excel column width in characters. */
  width?: number;
}

export interface ExportSheet<T> {
  name: string;
  columns: ExportColumn<T>[];
  rows: T[];
}

/** Wall-clock parts of `date` in `timeZone`. */
function wallClock(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), mi: get("minute") };
}

/** Two places, no float: "12.5" → "12.50", "-3.004" → "-3.00" (half away from zero). */
export function moneyText(value: string): string {
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(value.trim());
  if (!match) return value;
  const [, sign = "", wholeRaw = "", fracRaw = ""] = match;
  const scaled = BigInt(`${wholeRaw || "0"}${fracRaw.padEnd(3, "0").slice(0, 3)}`);
  const cents = (scaled + 5n) / 10n;
  const whole = cents / 100n;
  const frac = (cents % 100n).toString().padStart(2, "0");
  const isZero = cents === 0n;
  return `${sign && !isZero ? "-" : ""}${whole}.${frac}`;
}

/** "85.0000" → "85", "2.5000" → "2.5". Text in, text out. */
export function quantityText(value: string): string {
  if (!value.includes(".")) return value;
  const trimmed = value.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "-0" ? "0" : trimmed;
}

/**
 * A text cell that a spreadsheet would run as a formula — `=HYPERLINK(...)`
 * typed into a customer's name — is prefixed with an apostrophe, which shows
 * nothing and stops the evaluation. Only text columns: a money column's "-5"
 * is a number, not an attack.
 */
export function neutraliseFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function csvField(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function cellText<T>(column: ExportColumn<T>, row: T, timeZone: string): string {
  const raw = column.value(row);
  if (raw === null || raw === undefined || raw === "") return "";
  switch (column.kind ?? "text") {
    case "money":
      return moneyText(String(raw));
    case "quantity":
      return quantityText(String(raw));
    case "datetime": {
      const c = wallClock(raw instanceof Date ? raw : new Date(String(raw)), timeZone);
      return `${c.y}-${c.m}-${c.d} ${c.h}:${c.mi}`;
    }
    case "date": {
      if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
      const c = wallClock(raw instanceof Date ? raw : new Date(String(raw)), timeZone);
      return `${c.y}-${c.m}-${c.d}`;
    }
    default:
      return neutraliseFormula(String(raw));
  }
}

/**
 * RFC 4180, CRLF line ends, with a UTF-8 byte-order mark: without it Excel
 * opens the file as Windows-1252 and every Arabic customer name is mojibake.
 */
export function toCsv<T>(columns: ExportColumn<T>[], rows: T[], timeZone: string): string {
  const lines = [columns.map((c) => csvField(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvField(cellText(c, row, timeZone))).join(","));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

function excelCell<T>(column: ExportColumn<T>, row: T, timeZone: string): ExcelJS.CellValue {
  const raw = column.value(row);
  if (raw === null || raw === undefined || raw === "") return null;
  switch (column.kind ?? "text") {
    // The one place an amount becomes a float: a spreadsheet cell, where it
    // has to be a number to be summed. Nothing reads it back.
    case "money":
      return Number(moneyText(String(raw)));
    case "quantity":
      return Number(quantityText(String(raw)));
    case "datetime":
    case "date": {
      if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const [y, m, d] = raw.split("-").map(Number);
        return new Date(Date.UTC(y!, m! - 1, d!));
      }
      // Excel has no time zones: it shows whatever instant it is given as
      // if it were UTC. So it is given the business's wall clock, as UTC.
      const c = wallClock(raw instanceof Date ? raw : new Date(String(raw)), timeZone);
      return new Date(Date.UTC(+c.y, +c.m - 1, +c.d, +c.h, +c.mi));
    }
    default:
      // Plain text cell: exceljs only writes a formula when handed one
      // explicitly, so no neutralising is needed here.
      return String(raw);
  }
}

const EXCEL_FORMAT: Record<ExportKind, string | undefined> = {
  text: undefined,
  money: "#,##0.00",
  quantity: "#,##0.####",
  datetime: "yyyy-mm-dd hh:mm",
  date: "yyyy-mm-dd",
};

export async function toXlsx(sheets: ExportSheet<any>[], timeZone: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name.slice(0, 31), {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    ws.columns = sheet.columns.map((c) => ({
      header: c.header,
      width: c.width ?? Math.max(12, Math.min(40, c.header.length + 4)),
      style: EXCEL_FORMAT[c.kind ?? "text"] ? { numFmt: EXCEL_FORMAT[c.kind ?? "text"] } : {},
    }));
    ws.getRow(1).font = { bold: true };
    for (const row of sheet.rows) {
      ws.addRow(sheet.columns.map((c) => excelCell(c, row, timeZone)));
    }
    if (sheet.rows.length > 0) {
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** `sales_2026-10-01_2026-10-31.csv`, or `sales_2026-10-22.csv` with no range. */
export function exportFilename(base: string, format: ExportFormat, range: { from?: string; to?: string } = {}): string {
  const stamp =
    range.from || range.to
      ? `${range.from ?? "start"}_${range.to ?? "today"}`
      : new Date().toISOString().slice(0, 10);
  return `${base}_${stamp}.${format}`;
}

/**
 * CSV carries the first sheet only — it has no notion of a second one. Excel
 * gets every sheet.
 */
export async function sendExport(
  res: Response,
  file: { format: ExportFormat; filename: string; timeZone: string; sheets: ExportSheet<any>[] },
): Promise<void> {
  const body =
    file.format === "xlsx"
      ? await toXlsx(file.sheets, file.timeZone)
      : Buffer.from(toCsv(file.sheets[0]!.columns, file.sheets[0]!.rows, file.timeZone), "utf8");
  res.setHeader(
    "content-type",
    file.format === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "text/csv; charset=utf-8",
  );
  res.setHeader("content-disposition", `attachment; filename="${file.filename}"`);
  res.setHeader("content-length", String(body.length));
  res.end(body);
}
