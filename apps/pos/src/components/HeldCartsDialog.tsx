import { Clock, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog } from "./Dialog.js";
import { money } from "../lib/money.js";
import { posData, type PosHeldCart } from "../lib/pos-data.js";
import { Money } from "@devsfleet/shared-utils";

/**
 * Parked carts.
 *
 * A customer goes back to the van for their wallet; the till has to be free
 * before they return. The list is what a cashier scans to find the right one,
 * so it leads with the label they typed and the total — an id would be useless
 * and a line-by-line preview would be slower to read than the cart itself.
 */
export function HeldCartsDialog({
  open,
  onClose,
  onRestore,
}: {
  open: boolean;
  onClose: () => void;
  onRestore: (cartData: unknown) => void;
}) {
  const [carts, setCarts] = useState<PosHeldCart[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void posData.listHeldCarts().then(setCarts);
  }, [open]);

  async function restore(id: string) {
    setBusy(true);
    try {
      const cartData = await posData.restoreHeldCart(id);
      if (cartData) onRestore(cartData);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function discard(id: string) {
    await posData.discardHeldCart(id);
    setCarts((current) => current.filter((cart) => cart.id !== id));
  }

  return (
    <Dialog open={open} onClose={onClose} title="Held carts" width="lg">
      {carts.length === 0 ? (
        <p className="px-1 py-8 text-center text-[13px] text-steel-400">
          Nothing is parked. Press F8 during a sale to hold it.
        </p>
      ) : (
        <ul className="flex flex-col gap-px">
          {carts.map((cart) => (
            <li
              key={cart.id}
              className="flex items-center gap-3 bg-steel-850 px-3 py-2.5 first:rounded-t-lg last:rounded-b-lg"
            >
              <button
                type="button"
                disabled={busy}
                onClick={() => void restore(cart.id)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-steel-100">
                    {cart.label || "Unlabelled cart"}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-[12px] text-steel-400">
                    <Clock size={12} aria-hidden />
                    {heldFor(cart.heldAt)}
                    <span aria-hidden>·</span>
                    {cart.lineCount} {cart.lineCount === 1 ? "line" : "lines"}
                    {cart.customerName && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="truncate">{cart.customerName}</span>
                      </>
                    )}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[15px] tabular-nums text-brass-300">
                  {money(Money.toMinor(cart.total))}
                </span>
              </button>

              <button
                type="button"
                aria-label={`Discard ${cart.label || "cart"}`}
                onClick={() => void discard(cart.id)}
                className="shrink-0 rounded p-1.5 text-steel-500 hover:bg-signal-red/15 hover:text-signal-red"
              >
                <Trash2 size={15} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/**
 * "12 min" rather than a timestamp.
 *
 * How long ago is the question a cashier is actually asking — a cart parked
 * four hours ago is probably abandoned, and 14:32 does not say that at a glance.
 */
function heldFor(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}
