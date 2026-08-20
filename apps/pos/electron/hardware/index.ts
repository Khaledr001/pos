import type { PrintFormat } from "@devsfleet/shared-types";
import { app, shell, type IpcMain } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDatabase } from "../db/sqlite.js";
import { findSale, getState, recordDrawerOpen, setState } from "../db/repositories.js";
import { buildReceipt, type ReceiptBusiness, type ReceiptSale } from "./receipt-template.js";
import { renderA4Invoice } from "./a4-invoice.js";
import {
  createThermalPrinter,
  getPrinterDevicePath,
  isThermalFormat,
  setPrinterDevicePath,
} from "./printer.js";

/**
 * HARDWARE.
 *
 * RECEIPT PRINTER
 *   Thermal formats (58mm/80mm) go out as raw ESC/POS through
 *   `node-thermal-printer`, talking to the printer as a USB device file
 *   (see printer.ts) — not through Electron's print dialog, which cannot cut
 *   paper or control column widths.
 *
 * A4 TAX INVOICE
 *   A wholesale customer's copy: rendered as a real PDF with `pdfkit` (see
 *   a4-invoice.ts) — the same library the API already uses for quotation
 *   PDFs, so there is one PDF-rendering approach in this codebase, not two.
 *   Saved under userData and handed to `shell.openPath`, which opens the OS's
 *   own PDF viewer; printing it to an actual A4 printer is that viewer's
 *   native Print command, the same as any other document on the machine.
 *
 * CASH DRAWER
 *   Physically wired to the printer's RJ11 port; opening it means sending the
 *   ESC/POS kick pulse to the printer, appended to the SAME buffer as a
 *   receipt for a cash sale, or on its own for a manual "no sale" open.
 *   Every MANUAL open is recorded — recordDrawerOpen writes a local row and
 *   queues it for sync into audit_log. An automatic kick alongside a receipt
 *   needs no separate audit entry: the sale it printed for is already the
 *   record.
 *
 * BARCODE SCANNER
 *   A USB HID scanner emulates a keyboard, so the renderer handles it by
 *   listening for a fast keypress burst ending in Enter; nothing is needed
 *   here for that case.
 */

function businessInfo(): ReceiptBusiness {
  const raw = getState("business_info");
  if (!raw) {
    return {
      legalName: "",
      trn: null,
      phone: null,
      email: null,
      addressLines: [],
      currency: "AED",
      taxLabel: "VAT",
    };
  }
  return JSON.parse(raw) as ReceiptBusiness;
}

function customerName(customerId: string | null): string | null {
  if (!customerId) return null;
  const row = getDatabase()
    .prepare(`SELECT name FROM customers WHERE id = ?`)
    .get(customerId) as { name: string } | undefined;
  return row?.name ?? null;
}

/** One folder for every A4 invoice this terminal has produced — reprints overwrite by name, not append. */
function invoicesDir(): string {
  const dir = join(app.getPath("userData"), "invoices");
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function saveAndOpenA4(
  sale: ReceiptSale,
  business: ReceiptBusiness,
  options: { duplicate?: boolean; customerName?: string | null },
): Promise<void> {
  const buffer = await renderA4Invoice(sale, business, options);
  const name = sale.saleNumber ?? `PENDING-${sale.localId.slice(0, 8)}`;
  const path = join(invoicesDir(), `${name}${options.duplicate ? "-DUPLICATE" : ""}.pdf`);
  writeFileSync(path, buffer);
  await shell.openPath(path);
}

export function registerHardwareHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("printer:get-config", async () => ({
    devicePath: getPrinterDevicePath(),
    format: (getState("printer_format") as PrintFormat) || "thermal_80",
  }));

  ipcMain.handle(
    "printer:set-config",
    async (_event, config: { devicePath: string; format: PrintFormat }) => {
      setPrinterDevicePath(config.devicePath);
      setState("printer_format", config.format);
    },
  );

  ipcMain.handle("printer:list", async () => {
    // No OS-level enumeration — the terminal talks to one configured device
    // path, set in Settings. Reporting it back is what lets that screen show
    // what is actually configured rather than a blank list.
    return [{ name: getPrinterDevicePath(), isDefault: true }];
  });

  ipcMain.handle(
    "printer:receipt",
    async (_event, saleId: string, format?: PrintFormat, duplicate = false) => {
      // The cashier does not choose a format at the till — this terminal is
      // physically wired to one printer of one size. An explicit format is
      // for Settings' own "test this format" diagnostic, which deliberately
      // can ask for either.
      const resolved = format ?? ((getState("printer_format") as PrintFormat) || "thermal_80");

      const sale = findSale(saleId) as ReceiptSale & { customerId: string | null };
      if (!sale) throw new Error(`Sale ${saleId} not found on this terminal`);

      if (resolved === "a4") {
        await saveAndOpenA4(sale, businessInfo(), {
          duplicate,
          customerName: customerName(sale.customerId),
        });
        return;
      }
      // PrintFormat isn't a true literal union at the type level (see
      // packages/shared-types/src/enums.ts's asConst helper), so the "a4"
      // check above narrows nothing — this predicate is what actually does it.
      if (!isThermalFormat(resolved)) {
        throw new Error(`Unknown print format: ${resolved}`);
      }

      const printer = createThermalPrinter(resolved);
      buildReceipt(printer, sale, businessInfo(), {
        duplicate,
        customerName: customerName(sale.customerId),
      });

      // Cash physically changed hands — the drawer opens as part of the same
      // print job, not a separate action needing its own audit row.
      if (sale.payments.some((p) => p.method === "cash")) {
        printer.openCashDrawer();
      }

      await printer.execute();
    },
  );

  ipcMain.handle("printer:test", async (_event, format: PrintFormat) => {
    if (format === "a4") {
      await saveAndOpenA4(
        {
          saleNumber: "TEST-A4",
          localId: "test-a4",
          occurredAt: new Date().toISOString(),
          lines: [
            {
              productName: "Test Line Item",
              productSku: "TEST-SKU",
              quantity: "1",
              unitPrice: "10.00",
              discountPercent: "0",
              taxPercent: "5",
              total: "10.50",
            },
          ],
          subtotal: "10.00",
          taxAmount: "0.50",
          discountAmount: "0",
          total: "10.50",
          payments: [{ method: "cash", amount: "10.50" }],
        },
        businessInfo(),
        {},
      );
      return;
    }
    if (!isThermalFormat(format)) {
      throw new Error(`Unknown print format: ${format}`);
    }
    const printer = createThermalPrinter(format);
    printer.alignCenter();
    printer.bold(true);
    printer.println("TEST PAGE");
    printer.bold(false);
    printer.println(`Format: ${format}`);
    printer.println(`Columns: ${printer.getWidth()}`);
    printer.drawLine();
    printer.alignLeft();
    printer.println("The quick brown fox jumps over the lazy dog.");
    printer.newLine();
    printer.cut();
    await printer.execute();
  });

  ipcMain.handle("cash-drawer:open", async (_event, reason: string) => {
    if (!reason?.trim()) {
      throw new Error("A reason is required to open the drawer.");
    }
    // Any configured thermal printer can send the kick pulse — the format
    // only changes column width, which is irrelevant to a hardware pulse.
    const printer = createThermalPrinter((getState("printer_format") as "thermal_58" | "thermal_80") ?? "thermal_80");
    printer.openCashDrawer();
    await printer.execute();
    recordDrawerOpen(reason.trim());
  });

  // `device:info` and `device:activate` live in ../ipc/index.ts, next to the
  // state they read. Electron throws on a duplicate channel, so registering
  // them in two places is a startup crash, not a shadowed handler.
}
