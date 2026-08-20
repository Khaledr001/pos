import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { characterSet as CharacterSet, printer as ThermalPrinter, types as PrinterTypes } from "node-thermal-printer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildReceipt, type ReceiptBusiness, type ReceiptSale } from "../receipt-template.js";

/**
 * No physical printer exists in this environment, so this exercises the same
 * code path a real one would see: `node-thermal-printer`'s own `File`
 * interface writes the exact bytes `execute()` would otherwise send to a USB
 * device file — a scratch file stands in for /dev/usb/lp0. What is NOT
 * verified here is that a real thermal head produces a readable receipt from
 * these bytes; only that they are well-formed ESC/POS with the right content.
 */

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "receipt-test-"));
  path = join(dir, "printer-out");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const BUSINESS: ReceiptBusiness = {
  legalName: "DevsFleet Trading LLC",
  trn: "100234567800003",
  phone: "+971501234567",
  email: null,
  addressLines: ["Shop 4, Al Wahda Street", "Abu Dhabi, UAE"],
  currency: "AED",
  taxLabel: "VAT",
};

const SALE: ReceiptSale = {
  saleNumber: "INV-AUH-2026-000123",
  localId: "11111111-2222-3333-4444-555555555555",
  occurredAt: "2026-01-15T10:30:00Z",
  lines: [
    {
      productName: "PVC 90° Elbow 1 Inch",
      productSku: "PVC-ELB-90-1IN",
      quantity: "10",
      unitPrice: "2.75",
      discountPercent: "0",
      taxPercent: "5",
      total: "28.88",
    },
  ],
  subtotal: "27.50",
  taxAmount: "1.38",
  discountAmount: "0.00",
  total: "28.88",
  payments: [{ method: "cash", amount: "30.00" }],
};

function printerFor(format: "thermal_58" | "thermal_80" = "thermal_80") {
  return new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: path,
    width: format === "thermal_58" ? 32 : 48,
    // Matches printer.ts's own createThermalPrinter — without this, "90°"
    // silently becomes "90?" instead of exercising real encoding.
    characterSet: CharacterSet.WPC1252,
  });
}

describe("buildReceipt", () => {
  // Constructing with `characterSet` makes node-thermal-printer prepend a
  // "select code page" command (ESC 't' 16 for WPC1252) before anything the
  // template itself issues — genuine ESC/POS bytes, just not the template's.
  const CODE_PAGE_PREFIX = Buffer.from([0x1b, 0x74, 16]);

  it("produces a real ESC/POS buffer starting with the configured code page, then alignCenter", () => {
    const printer = printerFor();
    buildReceipt(printer, SALE, BUSINESS);
    const buffer = printer.getBuffer();
    expect(buffer.length).toBeGreaterThan(50);
    expect(buffer.subarray(0, 3)).toEqual(CODE_PAGE_PREFIX);
    // The template's own first call, alignCenter() -> ESC 'a' (0x1B 0x61),
    // immediately follows the code-page prefix.
    expect(buffer[3]).toBe(0x1b);
    expect(buffer[4]).toBe(0x61);
  });

  it("writes real bytes to the configured device path on execute()", async () => {
    const printer = printerFor();
    buildReceipt(printer, SALE, BUSINESS);
    await printer.execute();
    const written = readFileSync(path);
    expect(written.length).toBeGreaterThan(50);
    expect(written.subarray(0, 3)).toEqual(CODE_PAGE_PREFIX);
  });

  it("includes the business identity, invoice number and TRN as readable text", () => {
    const printer = printerFor();
    buildReceipt(printer, SALE, BUSINESS);
    const text = printer.getText();
    expect(text).toContain("DevsFleet Trading LLC");
    expect(text).toContain("100234567800003");
    expect(text).toContain("INV-AUH-2026-000123");
    expect(text).toContain("PVC 90");
  });

  it("encodes a non-ASCII product name as real WPC1252 bytes, not '?'", () => {
    // getText() decodes the buffer as UTF-8, which mangles a single-byte
    // WPC1252 character regardless of whether it encoded correctly — the
    // buffer itself is the only place this is actually checkable. 0xB0 is
    // "°" in WPC1252; 0x3F ('?') is what append() substitutes on a genuine
    // encoding failure, which is exactly the bug an unset characterSet caused.
    const printer = printerFor();
    buildReceipt(
      printer,
      { ...SALE, lines: [{ ...SALE.lines[0]!, productName: "PVC 90 Elbow" }] },
      BUSINESS,
    );
    const baseline = printer.getBuffer();

    const degreePrinter = printerFor();
    buildReceipt(
      degreePrinter,
      { ...SALE, lines: [{ ...SALE.lines[0]!, productName: "PVC 90° Elbow" }] },
      BUSINESS,
    );
    const withDegree = degreePrinter.getBuffer();

    expect(withDegree).toContain(0xb0);
    // Names differ only by the inserted "°" — one extra WPC1252 byte, not
    // the 1-byte '?' (0x3f) substitution append() falls back to on failure.
    expect(withDegree.length).toBe(baseline.length + 1);
  });

  it("shows a DUPLICATE marker only when reprinting", () => {
    const fresh = printerFor();
    buildReceipt(fresh, SALE, BUSINESS);
    expect(fresh.getText()).not.toContain("DUPLICATE");

    const reprint = printerFor();
    buildReceipt(reprint, SALE, BUSINESS, { duplicate: true });
    expect(reprint.getText()).toContain("DUPLICATE");
  });

  it("computes change as tendered minus total", () => {
    const printer = printerFor();
    // 30.00 tendered against a 28.88 total -> 1.12 change.
    buildReceipt(printer, SALE, BUSINESS);
    expect(printer.getText()).toContain("1.12");
  });

  it("shows no change line when paid exactly", () => {
    const printer = printerFor();
    buildReceipt(printer, { ...SALE, payments: [{ method: "cash", amount: "28.88" }] }, BUSINESS);
    expect(printer.getText()).not.toContain("Change");
  });

  it("renders correctly at both 58mm and 80mm widths", () => {
    for (const format of ["thermal_58", "thermal_80"] as const) {
      const printer = printerFor(format);
      buildReceipt(printer, SALE, BUSINESS);
      expect(printer.getBuffer().length).toBeGreaterThan(50);
    }
  });

  it("includes each tender method's own line", () => {
    const printer = printerFor();
    buildReceipt(
      printer,
      {
        ...SALE,
        payments: [
          { method: "card", amount: "20.00" },
          { method: "cash", amount: "8.88" },
        ],
      },
      BUSINESS,
    );
    const text = printer.getText();
    expect(text).toContain("Card");
    expect(text).toContain("Cash");
  });
});
