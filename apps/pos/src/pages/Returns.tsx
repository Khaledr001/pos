import { Money } from "@devsfleet/shared-utils";
import { Receipt, Search, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog } from "../components/Dialog.js";
import { KeyRail } from "../components/KeyRail.js";
import { amount, money, quantity as fmtQuantity } from "../lib/money.js";
import { posData, type PosSaleReceipt } from "../lib/pos-data.js";
import { useAuth } from "../store/auth.js";

/**
 * Returns.
 *
 * A return is always against an original sale — never a free-standing negative
 * amount. That constraint is the whole control: it caps what can come back at
 * what actually went out, keeps the refund priced at what the customer paid
 * rather than today's price, and leaves the original invoice untouched.
 *
 * The refund itself is recorded as a linked sale with negative quantities, so
 * the ledger stays append-only and the original document is never rewritten.
 */
export function Returns() {
  const { can } = useAuth();
  const [reference, setReference] = useState("");
  const [sale, setSale] = useState<PosSaleReceipt | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [recent, setRecent] = useState<PosSaleReceipt[]>([]);

  const allowed = can("sale:return");

  /**
   * Most returns are same-day: the customer bought the wrong size an hour ago
   * and has walked back in. Listing this till's recent sales turns the common
   * case into one tap, and leaves typing an invoice number for the genuinely
   * older ones.
   */
  useEffect(() => {
    void posData.recentSales(8).then(setRecent);
  }, []);

  async function find() {
    const trimmed = reference.trim();
    if (!trimmed) return;
    const found = await posData.findSale(trimmed);
    setSale(found);
    setNotFound(found === null);
    setQuantities({});
  }

  const refund = sale
    ? sale.lines.reduce<Money.Minor4>((sum, line, index) => {
        const qty = Number(quantities[String(index)] ?? "0");
        if (qty <= 0) return sum;
        const unit = Money.toMinor(line.unitPrice);
        return Money.add(sum, Money.multiplyByQuantity(unit, String(qty)));
      }, 0n)
    : 0n;

  const anySelected = Money.isPositive(refund);

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-5">
          {!allowed && (
            <p className="rounded-lg border border-signal-red/40 bg-signal-red/10 px-4 py-3 text-[13px] text-signal-red">
              Your role cannot process returns. Ask a manager to sign in.
            </p>
          )}

          <div className="panel p-5">
            <label htmlFor="sale-ref" className="eyebrow">
              Find the original sale
            </label>
            <div className="mt-2 flex gap-2">
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-500"
                  aria-hidden
                />
                <input
                  id="sale-ref"
                  autoFocus
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && find()}
                  className="field num pl-10"
                  placeholder="Invoice number from the receipt, e.g. INV-2026-000123"
                  disabled={!allowed}
                />
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={find}
                disabled={!allowed}
              >
                Find
              </button>
            </div>
            <p className="mt-2 text-[12px] text-zinc-500">
              Scan the barcode on the receipt, or type the number printed at the top.
            </p>
          </div>

          {notFound && (
            <p className="rounded-lg border border-steel-700 bg-steel-850 px-4 py-8 text-center text-[13px] text-zinc-500">
              No sale found for "{reference}". A sale made on another terminal
              only becomes searchable here after both have synced.
            </p>
          )}

          {!sale && (
            <div className="panel overflow-hidden">
              <h2 className="border-b border-steel-700 px-5 py-3.5 text-[13px] font-semibold">
                Recent sales from this till
              </h2>
              {recent.length === 0 ? (
                <p className="px-5 py-8 text-center text-[13px] text-zinc-500">
                  Nothing sold on this terminal yet. Once you ring up a sale it
                  appears here, so a same-day return needs no invoice number.
                </p>
              ) : (
                <ul>
                  {recent.map((entry) => (
                    <li key={entry.clientId}>
                      <button
                        type="button"
                        disabled={!allowed}
                        onClick={() => {
                          setSale(entry);
                          setNotFound(false);
                          setQuantities({});
                        }}
                        className="flex w-full items-center gap-4 border-b border-steel-800 px-5 py-3 text-left transition-colors hover:bg-steel-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Receipt className="size-4 shrink-0 text-zinc-600" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="num text-[13px] font-medium">
                            {entry.saleNumber ?? "Awaiting invoice number"}
                          </div>
                          <div className="text-[11px] text-zinc-500">
                            {new Date(entry.occurredAt).toLocaleTimeString("en-GB", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}{" "}
                            · {entry.lines.length}{" "}
                            {entry.lines.length === 1 ? "item" : "items"}
                            {!entry.synced && " · not yet synced"}
                          </div>
                        </div>
                        <span className="num text-[13px] font-semibold">
                          {amount(Money.toMinor(entry.total))}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {sale && (
            <div className="panel overflow-hidden">
              <div className="flex items-center justify-between border-b border-steel-700 px-5 py-4">
                <div className="flex items-center gap-3">
                  <Receipt className="size-4 text-brass" aria-hidden />
                  <div>
                    <div className="num text-[14px] font-semibold">
                      {sale.saleNumber ?? "Not yet numbered"}
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      {new Date(sale.occurredAt).toLocaleString("en-GB", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="eyebrow">Sale total</div>
                  <div className="num text-[14px] font-semibold">
                    {amount(Money.toMinor(sale.total))}
                  </div>
                </div>
              </div>

              <ul>
                {sale.lines.map((line, index) => {
                  const key = String(index);
                  const max = Number(line.quantity);
                  const selected = quantities[key] ?? "";

                  return (
                    <li
                      key={key}
                      className="flex items-center gap-4 border-b border-steel-800 px-5 py-3"
                    >
                      <span className="num w-5 text-right text-[11px] text-zinc-600">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">
                          {line.productName}
                        </div>
                        <div className="num mt-0.5 text-[11px] text-zinc-500">
                          {line.productSku} · sold {fmtQuantity(line.quantity)} ×{" "}
                          {amount(Money.toMinor(line.unitPrice))}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <label htmlFor={`return-${key}`} className="eyebrow">
                          Return
                        </label>
                        <input
                          id={`return-${key}`}
                          value={selected}
                          onChange={(e) => {
                            const raw = Number(e.target.value);
                            // Cannot return more than was sold. The cap is the
                            // point of doing this against the original sale.
                            const clamped = Number.isFinite(raw)
                              ? Math.max(0, Math.min(raw, max))
                              : 0;
                            setQuantities((q) => ({
                              ...q,
                              [key]: e.target.value === "" ? "" : String(clamped),
                            }));
                          }}
                          inputMode="decimal"
                          placeholder="0"
                          disabled={!allowed}
                          className="field num w-24 text-right"
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="tear flex items-baseline justify-between px-5 py-4">
                <span className="eyebrow">Refund due</span>
                <span className="num text-3xl font-bold text-brass">{money(refund)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <KeyRail
        actions={[
          { combo: "Enter", label: "Find sale", onPress: find, disabled: !allowed },
          {
            combo: "F4",
            label: anySelected ? `Refund ${money(refund)}` : "Refund",
            onPress: () => setConfirming(true),
            disabled: !anySelected || !allowed,
            primary: true,
          },
        ]}
      />

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Confirm the refund"
        description="This creates a linked return. The original invoice is not modified."
        width="sm"
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                // TODO(phase-3): write the linked return to the outbox and open
                // the drawer for a cash refund.
                setConfirming(false);
                setSale(null);
                setReference("");
                setQuantities({});
              }}
            >
              <Undo2 className="size-4" aria-hidden />
              Refund {money(refund)}
            </button>
          </>
        }
      >
        <p className="text-[13px] text-zinc-400">
          {money(refund)} goes back to the customer, and the returned stock comes
          back into this branch.
        </p>
      </Dialog>
    </>
  );
}
