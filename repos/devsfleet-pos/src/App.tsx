import { DEFAULT_TENANT_SETTINGS } from "@devsfleet/shared-types";
import { Money, calculateDocument } from "@devsfleet/shared-utils";
import { useEffect, useState } from "react";
import type { DevsfleetBridge } from "../electron/preload.js";

declare global {
  interface Window {
    devsfleet: DevsfleetBridge;
  }
}

/**
 * Scaffold shell.
 *
 * It renders a cart priced by the shared totals engine rather than static
 * markup, so a successful build proves the whole chain works: the renderer
 * resolves workspace packages, the preload bridge is reachable, and money
 * arithmetic behaves identically here and in the API.
 *
 * Replaced by the real POS screens (Login, POS, CashRegister, Returns,
 * Settings) in Phase 3.
 */
export function App() {
  const [syncStatus, setSyncStatus] = useState<string>("checking…");

  useEffect(() => {
    // The bridge is absent when the renderer runs in a plain browser tab
    // (`pnpm dev` without Electron), so this must not assume it exists.
    if (typeof window.devsfleet === "undefined") {
      setSyncStatus("no electron bridge — running in a browser");
      return;
    }

    let cancelled = false;
    void window.devsfleet.sync.status().then((status) => {
      if (!cancelled) setSyncStatus(status.online ? "online" : "offline");
    });

    const unsubscribe = window.devsfleet.sync.onStatusChange((status) =>
      setSyncStatus(status.online ? "online" : "offline"),
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const cart = [
    { name: 'PVC Elbow 1" 90°', sku: "PVC-ELB-001", quantity: 50, unitPrice: "2.20" },
    { name: "Basin Mixer Tap Chrome", sku: "TAP-MIX-CHR", quantity: 1, unitPrice: "135.00" },
  ];

  const totals = calculateDocument({
    taxMode: DEFAULT_TENANT_SETTINGS.tax.mode,
    lines: cart.map((line) => ({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxPercent: DEFAULT_TENANT_SETTINGS.tax.defaultRate,
    })),
  });

  const money = (amount: bigint) =>
    Money.formatMoney(amount, { currency: DEFAULT_TENANT_SETTINGS.currency.base });

  return (
    <div className="app">
      <header className="app__header">
        <h1>DevsFleet POS</h1>
        <span className={`badge badge--${syncStatus === "online" ? "ok" : "warn"}`}>
          {syncStatus}
        </span>
      </header>

      <main className="app__main">
        <table className="cart">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Qty</th>
              <th className="num">Price</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {cart.map((line, i) => (
              <tr key={line.sku}>
                <td>
                  {line.name}
                  <span className="sku">{line.sku}</span>
                </td>
                <td className="num">{line.quantity}</td>
                <td className="num">{line.unitPrice}</td>
                <td className="num">{money(totals.lines[i]!.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>Subtotal</td>
              <td className="num">{money(totals.subtotal)}</td>
            </tr>
            <tr>
              <td colSpan={3}>
                {DEFAULT_TENANT_SETTINGS.tax.label} {DEFAULT_TENANT_SETTINGS.tax.defaultRate}%
              </td>
              <td className="num">{money(totals.taxAmount)}</td>
            </tr>
            <tr className="cart__total">
              <td colSpan={3}>Total</td>
              <td className="num">{money(totals.total)}</td>
            </tr>
          </tfoot>
        </table>

        <p className="note">
          Scaffold. Cart, payments, cash register, returns and hardware land in
          Phase 3 — see <code>docs/ROADMAP.md</code>.
        </p>
      </main>
    </div>
  );
}
