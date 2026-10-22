import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  assertExportSize,
  exportFilename,
  MAX_EXPORT_ROWS,
  moneyText,
  neutraliseFormula,
  quantityText,
  toCsv,
  toXlsx,
  type ExportColumn,
} from "./send-export.js";

interface Row {
  name: string;
  total: string;
  qty: string;
  at: Date;
}

const columns: ExportColumn<Row>[] = [
  { header: "Customer", value: (r) => r.name },
  { header: "Total", kind: "money", value: (r) => r.total },
  { header: "Qty", kind: "quantity", value: (r) => r.qty },
  { header: "When", kind: "datetime", value: (r) => r.at },
];

// 2026-10-01 00:30 in Dubai is still 30 September in UTC — the VAT-return
// boundary case.
const rows: Row[] = [
  { name: 'Ali "Trading", LLC', total: "1250.5000", qty: "85.0000", at: new Date("2026-09-30T20:30:00Z") },
  { name: "=HYPERLINK(\"x\")", total: "-3.0040", qty: "2.5000", at: new Date("2026-10-15T08:00:00Z") },
  { name: "محمد", total: "0.0050", qty: "1", at: new Date("2026-10-31T19:59:00Z") },
];

describe("moneyText", () => {
  it("fixes two places from the stored decimal, without floats", () => {
    expect(moneyText("1250.5000")).toBe("1250.50");
    expect(moneyText("0.3000")).toBe("0.30");
    expect(moneyText("12")).toBe("12.00");
  });

  it("rounds half away from zero, and never prints -0.00", () => {
    expect(moneyText("0.0050")).toBe("0.01");
    expect(moneyText("-3.0040")).toBe("-3.00");
    expect(moneyText("-0.0010")).toBe("0.00");
  });
});

describe("quantityText", () => {
  it("drops trailing zeros", () => {
    expect(quantityText("85.0000")).toBe("85");
    expect(quantityText("2.5000")).toBe("2.5");
    expect(quantityText("7")).toBe("7");
  });
});

describe("neutraliseFormula", () => {
  it("defuses text a spreadsheet would run", () => {
    expect(neutraliseFormula("=1+1")).toBe("'=1+1");
    expect(neutraliseFormula("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(neutraliseFormula("Plain name")).toBe("Plain name");
  });
});

describe("toCsv", () => {
  const csv = toCsv(columns, rows, "Asia/Dubai");
  const lines = csv.split("\r\n");

  it("starts with a UTF-8 BOM so Excel reads Arabic correctly", () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("محمد");
  });

  it("quotes per RFC 4180", () => {
    expect(lines[1]).toBe('"Ali ""Trading"", LLC",1250.50,85,2026-10-01 00:30');
  });

  it("neutralises formulas in text but leaves negative amounts alone", () => {
    expect(lines[2]).toBe(`"'=HYPERLINK(""x"")",-3.00,2.5,2026-10-15 12:00`);
  });

  it("shows times on the business's clock", () => {
    expect(lines[3]).toBe("محمد,0.01,1,2026-10-31 23:59");
  });
});

describe("toXlsx", () => {
  it("writes amounts as numbers Excel can sum, and dates as dates", async () => {
    const buffer = await toXlsx([{ name: "Sales", columns, rows }], "Asia/Dubai");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = workbook.getWorksheet("Sales")!;

    expect(ws.rowCount).toBe(4);
    expect(ws.getCell("B2").value).toBe(1250.5);
    expect(ws.getCell("B2").numFmt).toBe("#,##0.00");
    expect(ws.getCell("A3").value).toBe('=HYPERLINK("x")');
    expect((ws.getCell("D2").value as Date).toISOString()).toBe("2026-10-01T00:30:00.000Z");
  });
});

describe("assertExportSize", () => {
  it("refuses an export past the limit", () => {
    expect(() => assertExportSize(MAX_EXPORT_ROWS)).not.toThrow();
    expect(() => assertExportSize(MAX_EXPORT_ROWS + 1)).toThrow(/Narrow the date range/);
  });
});

describe("exportFilename", () => {
  it("names the period", () => {
    expect(exportFilename("sales", "csv", { from: "2026-10-01", to: "2026-10-31" })).toBe(
      "sales_2026-10-01_2026-10-31.csv",
    );
  });
});
