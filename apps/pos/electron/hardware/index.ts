import type { PrintFormat } from "@devsfleet/shared-types";
import type { IpcMain } from "electron";

/**
 * HARDWARE — Phase 3.
 *
 * Scaffold only. Three devices, three different problems:
 *
 * RECEIPT PRINTER
 *   Three formats are required: thermal 58mm, thermal 80mm, and A4 for tax
 *   invoices. The thermal formats go out as raw ESC/POS through
 *   `node-thermal-printer` over USB or network — not through Electron's print
 *   dialog, which cannot cut paper or control column widths. A4 renders HTML
 *   and uses `webContents.printToPDF` / `print`.
 *
 * CASH DRAWER
 *   Physically wired to the printer's RJ11 port; opening it means sending the
 *   ESC/POS kick pulse (ESC p m t1 t2) to the printer. There is no separate
 *   device to talk to. Every open must record a reason — an unaudited drawer
 *   button is a shrinkage hole.
 *
 * BARCODE SCANNER
 *   A USB HID scanner emulates a keyboard, so the renderer handles it by
 *   listening for a fast keypress burst ending in Enter; nothing is needed here
 *   for that case. This module is only for scanners in serial/COM mode, which
 *   the renderer cannot see at all.
 */

export function registerHardwareHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("printer:list", async () => {
    // TODO(phase-3): enumerate system printers plus configured network printers.
    return [];
  });

  ipcMain.handle("printer:receipt", async (_event, _saleId: string, _format: PrintFormat) => {
    // TODO(phase-3): load the sale from SQLite, render for the format, print.
    throw new Error("Receipt printing lands in Phase 3");
  });

  ipcMain.handle("printer:test", async (_event, _format: PrintFormat) => {
    // TODO(phase-3): print an alignment page. Needed during installation.
    throw new Error("Test printing lands in Phase 3");
  });

  ipcMain.handle("cash-drawer:open", async (_event, _reason: string) => {
    // TODO(phase-3): send the ESC/POS kick pulse and write a cash_movements row.
    throw new Error("Cash drawer control lands in Phase 3");
  });

  // `device:info` and `device:activate` live in ../ipc/index.ts, next to the
  // state they read. Electron throws on a duplicate channel, so registering
  // them in two places is a startup crash, not a shadowed handler.
}
