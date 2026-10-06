import ExcelJS from "exceljs";
import { normalizeKey } from "./text.js";

export interface SheetRow {
  name: string;
  brand: string | null;
  subCategory: string | null;
}

const cellText = (value: ExcelJS.CellValue): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "result" in value) return String(value.result ?? "");
  if (typeof value === "object" && "text" in value) return String(value.text ?? "");
  return String(value).trim();
};

/**
 * The shop's Excel price list, used only to fill in what the catalogue lacks
 * (brand, sub-category) for the search query. Matched to products by
 * normalised name; the sheet never overrides what the API already knows.
 */
export async function readSheet(path: string): Promise<Map<string, SheetRow>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const rows = new Map<string, SheetRow>();

  for (const sheet of workbook.worksheets) {
    const header = sheet.getRow(1);
    const columns = new Map<string, number>();
    header.eachCell((cell, col) => columns.set(cellText(cell.value).toLowerCase().replace(/\*/g, "").trim(), col));
    const nameCol = columns.get("name");
    if (!nameCol) continue; // "Category Map" and the like
    const brandCol = columns.get("brand");
    const subCol = columns.get("sub category");

    sheet.eachRow((row, index) => {
      if (index === 1) return;
      const name = cellText(row.getCell(nameCol).value);
      if (!name) return;
      rows.set(normalizeKey(name), {
        name,
        brand: brandCol ? cellText(row.getCell(brandCol).value) || null : null,
        subCategory: subCol ? cellText(row.getCell(subCol).value) || null : null,
      });
    });
  }
  return rows;
}
