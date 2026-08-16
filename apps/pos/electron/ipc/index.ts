import { createHash } from "node:crypto";
import { hostname, networkInterfaces, platform } from "node:os";
import type { IpcMain } from "electron";
import { app } from "electron";
import * as repo from "../db/repositories.js";
import { loginWithPin } from "../sync/api-client.js";
import { syncNow } from "../sync/index.js";

/**
 * Every handler the preload bridge declares, in one place.
 *
 * Each one is a thin wrapper over `repositories.ts` — the main process holds no
 * business logic of its own. Totals, floors and tax are computed by
 * `@devsfleet/shared-utils`, the same code the API runs, so a receipt printed
 * offline and the invoice the server later issues cannot disagree.
 */
export function registerDataHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("catalog:search", (_event, query: string, limit?: number) =>
    repo.searchProducts(query ?? "", limit),
  );
  ipcMain.handle("catalog:by-barcode", (_event, barcode: string) =>
    repo.findByBarcode(barcode ?? ""),
  );
  ipcMain.handle("customers:search", (_event, query: string) =>
    repo.searchCustomers(query ?? ""),
  );

  ipcMain.handle("cash:current", () => repo.getOpenCashSession());
  ipcMain.handle("cash:open", (_event, openingAmount: string) =>
    repo.openCashSession(String(openingAmount ?? "0"), repo.getState("branch_id")),
  );
  ipcMain.handle("cash:close", (_event, countedAmount: string, notes?: string) => {
    repo.closeCashSession(String(countedAmount ?? "0"), notes);
    syncNow();
  });
  ipcMain.handle(
    "cash:movement",
    (_event, type: "cash_in" | "cash_out", amount: string, reason: string) => {
      repo.recordCashMovement(type, String(amount ?? "0"), reason ?? "");
    },
  );

  ipcMain.handle("sales:commit", (_event, draft: repo.SaleDraftInput) => {
    const receipt = repo.commitSale(draft);
    // Fire and forget. Waiting for the server would put the counter behind the
    // shop's internet connection, which is precisely what offline-first means
    // to avoid.
    syncNow();
    return receipt;
  });
  ipcMain.handle("sales:recent", (_event, limit?: number) => repo.recentSales(limit));
  ipcMain.handle("sales:find", (_event, reference: string) => repo.findSale(reference ?? ""));

  ipcMain.handle("auth:pin-login", async (_event, pin: string) => {
    const user = await loginWithPin(String(pin ?? ""));
    syncNow();
    return user;
  });

  ipcMain.handle("device:info", () => ({
    deviceId: repo.getState("device_id"),
    branchId: repo.getState("branch_id"),
    apiUrl: repo.getState("api_url"),
    hardwareId: hardwareId(),
    version: app.getVersion(),
  }));

  /**
   * Bind this installation to a device row.
   *
   * Deliberately manual: an operator pastes the terminal id and branch id an
   * administrator created for them. A self-registering terminal is a terminal
   * anybody with the installer can add to your tenant.
   */
  ipcMain.handle(
    "device:activate",
    (_event, activationCode: string, apiUrl: string) => {
      const [device, branch] = String(activationCode ?? "").split(":");
      if (!device || !branch) {
        throw new Error("Activation code must be <terminal-id>:<branch-id>");
      }

      repo.setState("api_url", String(apiUrl ?? "").replace(/\/+$/, ""));
      repo.setState("device_id", device.trim());
      repo.setState("branch_id", branch.trim());
      repo.setState("hardware_id", hardwareId());

      syncNow();
      return { deviceId: device.trim() };
    },
  );
}

/**
 * A stable fingerprint for this machine.
 *
 * MAC address plus hostname plus platform, hashed. Not a security boundary —
 * it is how the server notices the same terminal reinstalled versus a second
 * one quietly sharing an activation.
 */
function hardwareId(): string {
  const macs = Object.values(networkInterfaces())
    .flat()
    .filter((iface): iface is NonNullable<typeof iface> => Boolean(iface))
    .filter((iface) => !iface.internal && iface.mac && iface.mac !== "00:00:00:00:00:00")
    .map((iface) => iface.mac)
    .sort();

  return createHash("sha256")
    .update([...macs, hostname(), platform()].join("|"))
    .digest("hex")
    .slice(0, 32);
}
