import type { PrintFormat } from "@devsfleet/shared-types";
import { characterSet as CharacterSet, printer as ThermalPrinter, types as PrinterTypes } from "node-thermal-printer";
import { getState, setState } from "../db/repositories.js";

/**
 * USB thermal printer, talked to as a raw device file — no native Node
 * module, no Electron-ABI rebuild, no driver install beyond the printer
 * showing up as a kernel usblp device (the common case for a USB receipt
 * printer on Linux). `node-thermal-printer`'s own `File` interface does
 * exactly this: `fs.writeFile` to a path, nothing more.
 *
 * A network or Windows-native-spooler printer would need a different
 * interface string here (`tcp://host:port`, or `printer:name` with a driver
 * module) — deliberately out of scope until that hardware is actually in
 * front of a till. See docs/DECISIONS.md #3.
 */

const COLUMNS: Record<"thermal_58" | "thermal_80", number> = {
  thermal_58: 32,
  thermal_80: 48,
};

const DEFAULT_DEVICE_PATH = "/dev/usb/lp0";

export function getPrinterDevicePath(): string {
  return getState("printer_device_path") ?? DEFAULT_DEVICE_PATH;
}

export function setPrinterDevicePath(path: string): void {
  setState("printer_device_path", path.trim() || null);
}

/** Format defaults to the tenant's own printing setting when the caller has none in hand. */
export function createThermalPrinter(format: "thermal_58" | "thermal_80"): InstanceType<typeof ThermalPrinter> {
  return new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: getPrinterDevicePath(),
    width: COLUMNS[format],
    // Without this, a product name carrying anything outside plain ASCII —
    // a degree sign, an accent — prints as a literal "?": append() silently
    // substitutes on an encoding failure rather than throwing, so this is
    // the kind of gap that only shows up on the receipt, never in a log a
    // developer would see. WPC1252 covers Latin-1, which is what a catalogue
    // typed by a UAE retailer actually produces.
    characterSet: CharacterSet.WPC1252,
    options: { timeout: 5000 },
  });
}

export function isThermalFormat(format: PrintFormat): format is "thermal_58" | "thermal_80" {
  return format === "thermal_58" || format === "thermal_80";
}

/**
 * `isPrinterConnected()` checks the device FILE exists, not that a printer is
 * actually listening on the other end of it — the kernel node appears the
 * moment the printer is plugged in, and disappears the moment it is not. That
 * is the honest limit of talking to it this way: a printer that is plugged in
 * but out of paper still reports "connected".
 */
export async function isPrinterReachable(format: "thermal_58" | "thermal_80"): Promise<boolean> {
  const printer = createThermalPrinter(format);
  return printer.isPrinterConnected();
}
