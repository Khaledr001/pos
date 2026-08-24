import { Clock, ShoppingCart, Trash2 } from "lucide-react";
import React, { useEffect, useState } from "react";
import { Dialog } from "./Dialog.js";
import { money } from "../lib/money.js";
import { posData, type PosHeldCart } from "../lib/pos-data.js";
import { Money } from "@devsfleet/shared-utils";

/**
 * Parked Carts Dialog.
 *
 * Allows cashiers to restore or discard suspended carts.
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
    void posData.listHeldCarts().then((list) => setCarts(list ?? []));
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
    <Dialog open={open} onClose={onClose} title="Held Carts (Parked Sales)" width="md">
      {carts.length === 0 ? (
        <div className="py-12 text-center text-[var(--pos-text-3)]">
          <ShoppingCart className="size-10 mx-auto mb-2 opacity-30 text-[var(--pos-text-3)]" />
          <p className="text-xs font-semibold text-[var(--pos-text)]">No carts currently on hold</p>
          <p className="text-[11px] text-[var(--pos-text-3)] mt-0.5">
            Press F8 while building a cart to park it for later.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--pos-border)] border border-[var(--pos-border)] rounded-xl overflow-hidden bg-[var(--pos-panel)]">
          {carts.map((cart) => (
            <li
              key={cart.id}
              className="flex items-center justify-between gap-3 p-3.5 hover:bg-[var(--pos-raised)]/60 transition-colors"
            >
              <button
                type="button"
                disabled={busy}
                onClick={() => void restore(cart.id)}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left disabled:opacity-50 cursor-pointer"
              >
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold text-[var(--pos-text)]">
                    {cart.label || "Unlabelled Cart"}
                  </span>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--pos-text-3)]">
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" />
                      {heldFor(cart.heldAt)}
                    </span>
                    <span>·</span>
                    <span>
                      {cart.lineCount} {cart.lineCount === 1 ? "line" : "lines"}
                    </span>
                    {cart.customerName && (
                      <>
                        <span>·</span>
                        <span className="truncate font-medium text-[var(--pos-text-2)]">{cart.customerName}</span>
                      </>
                    )}
                  </div>
                </div>
                <span className="shrink-0 font-mono font-bold text-sm text-[var(--pos-accent)]">
                  {money(Money.toMinor(cart.total))}
                </span>
              </button>

              <button
                type="button"
                aria-label={`Discard ${cart.label || "cart"}`}
                onClick={() => void discard(cart.id)}
                className="size-7 rounded-lg text-[var(--pos-text-3)] hover:text-signal-red hover:bg-signal-red/10 flex items-center justify-center transition-colors shrink-0"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function heldFor(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}
