import type { PaymentMethod } from "@devsfleet/shared-types";
import { Money } from "@devsfleet/shared-utils";
import { CheckCircle2, Printer, Search as SearchIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { Dialog } from "../components/Dialog.js";
import { KeyRail, type KeyAction } from "../components/KeyRail.js";
import { PaymentDialog } from "../components/PaymentDialog.js";
import { ProductSearch } from "../components/ProductSearch.js";
import { ReceiptPanel } from "../components/ReceiptPanel.js";
import { useBarcodeScanner, useHotkeys } from "../lib/keyboard.js";
import { amount, money } from "../lib/money.js";
import { hasBridge, posData, type PosCustomer } from "../lib/pos-data.js";
import { useCart, useCartTotals, useFloorViolations, type CartLine } from "../store/cart.js";
import { useAuth } from "../store/auth.js";

/**
 * The sale screen — where the terminal spends its day.
 *
 * Layout is the standard till split, and standard is correct here: cashiers
 * move between shops and an unfamiliar arrangement costs real time. Search and
 * results on the left where the eye starts, the receipt on the right where it
 * ends, the key rail beneath both.
 */
export function Sale({ cashSessionId }: { cashSessionId: string | null }) {
  const cart = useCart();
  const totals = useCartTotals();
  const violations = useFloorViolations();
  const { can } = useAuth();

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [editing, setEditing] = useState<CartLine | null>(null);
  const [completed, setCompleted] = useState<{ change: Money.Minor4 } | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const [scanMiss, setScanMiss] = useState<string | null>(null);

  const empty = cart.lines.length === 0;
  const blocked = violations.length > 0;

  /**
   * A scan resolves against the local catalogue and lands straight in the cart.
   * A code that matches nothing is surfaced rather than swallowed — silence
   * after a beep makes a cashier scan the same box three times.
   */
  useBarcodeScanner(
    useCallback((barcode: string) => {
      void posData.findByBarcode(barcode).then((product) => {
        if (product) {
          useCart.getState().addProduct(product);
          setScanMiss(null);
        } else {
          setScanMiss(barcode);
        }
      });
    }, []),
    { enabled: !paymentOpen && !customerOpen && !editing },
  );

  const charge = useCallback(() => {
    if (empty || blocked || !cashSessionId) return;
    setPaymentOpen(true);
  }, [empty, blocked, cashSessionId]);

  useHotkeys({
    f1: () => setFocusSignal((n) => n + 1),
    f2: () => setCustomerOpen(true),
    f4: charge,
    escape: () => {
      if (!empty) cart.clear();
    },
  });

  async function completeSale(
    payments: Array<{ method: PaymentMethod; amount: string; reference?: string }>,
    change: Money.Minor4,
  ) {
    const draft = {
      clientId: crypto.randomUUID(),
      customerId: cart.customer?.id ?? null,
      cashSessionId,
      lines: cart.lines.map((line, index) => ({
        productId: line.product.id,
        productName: line.product.name,
        productSku: line.product.sku,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountPercent: line.discountPercent,
        taxPercent: line.product.taxPercent,
        total: Money.toDecimalString(totals.lines[index]?.total ?? 0n, 2),
      })),
      subtotal: Money.toDecimalString(totals.subtotal, 2),
      taxAmount: Money.toDecimalString(totals.taxAmount, 2),
      discountAmount: Money.toDecimalString(totals.discountAmount, 2),
      total: Money.toDecimalString(totals.total, 2),
      payments,
      occurredAt: new Date().toISOString(),
    };

    // Writes locally and returns. It does not wait for the network — the
    // customer is standing here and the sale has already happened.
    await posData.commitSale(draft);

    setPaymentOpen(false);
    setCompleted({ change });
    cart.clear();
    setFocusSignal((n) => n + 1);
  }

  const railActions: KeyAction[] = [
    { combo: "F1", label: "Search", onPress: () => setFocusSignal((n) => n + 1) },
    { combo: "F2", label: "Customer", onPress: () => setCustomerOpen(true) },
    {
      combo: "F3",
      label: "Discount",
      onPress: () => cart.lines[0] && setEditing(cart.lines[0]),
      disabled: empty || !can("sale:discount"),
    },
    {
      combo: "F4",
      label: empty ? "Charge" : `Charge ${money(totals.total)}`,
      onPress: charge,
      disabled: empty || blocked || !cashSessionId,
      primary: true,
    },
    {
      combo: "Esc",
      label: "Clear sale",
      onPress: () => cart.clear(),
      disabled: empty,
      tone: "danger",
    },
  ];

  return (
    <>
      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          {!cashSessionId && (
            <p className="rounded-lg border border-signal-amber/40 bg-signal-amber/10 px-4 py-3 text-[13px] text-signal-amber">
              The cash drawer is closed. Open it from the Drawer screen before
              taking payment.
            </p>
          )}

          {scanMiss && (
            <p
              role="alert"
              className="flex items-center justify-between gap-3 rounded-lg border border-signal-red/40 bg-signal-red/10 px-4 py-3 text-[13px] text-signal-red"
            >
              <span>
                Barcode <span className="num font-semibold">{scanMiss}</span> is not in
                the catalogue.
              </span>
              <button
                type="button"
                onClick={() => setScanMiss(null)}
                className="shrink-0 rounded px-2 py-1 text-[12px] underline underline-offset-2"
              >
                Dismiss
              </button>
            </p>
          )}

          <ProductSearch
            autoFocusSignal={focusSignal}
            onPick={(product) => cart.addProduct(product)}
          />
        </section>

        <ReceiptPanel
          onPickCustomer={() => setCustomerOpen(true)}
          onEditLine={setEditing}
        />
      </div>

      <KeyRail actions={railActions} />

      <PaymentDialog
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        total={totals.total}
        customer={cart.customer}
        onConfirm={completeSale}
      />

      <CustomerDialog
        open={customerOpen}
        onClose={() => setCustomerOpen(false)}
        onPick={(customer) => {
          cart.setCustomer(customer);
          setCustomerOpen(false);
        }}
      />

      {editing && (
        <LineEditor
          line={editing}
          onClose={() => setEditing(null)}
          canOverrideFloor={can("price:override_floor")}
        />
      )}

      <SaleCompleteDialog
        result={completed}
        onClose={() => setCompleted(null)}
      />
    </>
  );
}

// -----------------------------------------------------------------------------

function CustomerDialog({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (customer: PosCustomer) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PosCustomer[]>([]);

  const search = useCallback((value: string) => {
    setQuery(value);
    void posData.searchCustomers(value).then(setResults);
  }, []);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Attach a customer"
      description="Needed for credit sales and for a TRN on the invoice."
    >
      <div className="relative mb-3">
        <SearchIcon
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-500"
          aria-hidden
        />
        <input
          autoFocus
          value={query}
          onChange={(e) => search(e.target.value)}
          onFocus={() => results.length === 0 && search("")}
          className="field pl-10"
          placeholder="Name, company, or phone"
          aria-label="Search customers"
        />
      </div>

      <ul className="space-y-1.5">
        {results.map((customer) => {
          const available = Money.subtract(
            Money.toMinor(customer.creditLimit),
            Money.toMinor(customer.creditBalance),
          );
          return (
            <li key={customer.id}>
              <button
                type="button"
                onClick={() => onPick(customer)}
                className="flex w-full items-center gap-4 rounded-lg border border-steel-700 bg-steel-800 px-3.5 py-3 text-left transition-colors hover:bg-steel-750"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium">{customer.name}</div>
                  <div className="num mt-0.5 truncate text-[11px] text-zinc-500">
                    {customer.company ?? customer.phone ?? "No contact details"}
                  </div>
                </div>
                {Number(customer.creditLimit) > 0 && (
                  <div className="text-right">
                    <div className="eyebrow">Credit left</div>
                    <div
                      className={`num text-[12px] ${
                        Money.isPositive(available) ? "text-zinc-300" : "text-signal-red"
                      }`}
                    >
                      {amount(available)}
                    </div>
                  </div>
                )}
              </button>
            </li>
          );
        })}
        {results.length === 0 && query && (
          <li className="py-8 text-center text-[13px] text-zinc-500">
            No customer matches "{query}".
          </li>
        )}
      </ul>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------

/**
 * Price and discount editor.
 *
 * The floor price is enforced here rather than only at checkout, so a cashier
 * finds out immediately instead of at the moment the customer is handing over
 * money. Crossing it needs `price:override_floor`, which a cashier role does
 * not carry — this is the main control against counter discounting.
 */
function LineEditor({
  line,
  onClose,
  canOverrideFloor,
}: {
  line: CartLine;
  onClose: () => void;
  canOverrideFloor: boolean;
}) {
  const { setUnitPrice, setLineDiscount } = useCart();
  const [price, setPrice] = useState(line.unitPrice);
  const [discount, setDiscount] = useState(line.discountPercent);

  const floor = line.product.minSellingPrice
    ? Money.toMinor(line.product.minSellingPrice)
    : null;
  const unit = Money.toMinor(price || "0");
  const effective = Money.subtract(unit, Money.percentOf(unit, discount || "0"));
  const belowFloor = floor !== null && effective < floor;

  function apply() {
    setUnitPrice(line.key, price, belowFloor && canOverrideFloor);
    setLineDiscount(line.key, discount || "0");
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={line.product.name}
      description={`${line.product.sku} · list ${amount(Money.toMinor(line.product.sellingPrice))}`}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={apply}
            disabled={belowFloor && !canOverrideFloor}
          >
            Apply
          </button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="line-price" className="eyebrow">
            Unit price
          </label>
          <input
            id="line-price"
            autoFocus
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            className="field num mt-1.5 text-right text-lg font-semibold"
          />
        </div>
        <div>
          <label htmlFor="line-discount" className="eyebrow">
            Discount %
          </label>
          <input
            id="line-discount"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            inputMode="decimal"
            className="field num mt-1.5 text-right text-lg font-semibold"
          />
        </div>
      </div>

      <div className="mt-4 flex items-baseline justify-between rounded-lg bg-steel-800 px-3.5 py-3">
        <span className="eyebrow">Effective unit price</span>
        <span
          className={`num text-lg font-semibold ${belowFloor ? "text-signal-red" : "text-chalk"}`}
        >
          {amount(effective)}
        </span>
      </div>

      {belowFloor && (
        <p
          className={`mt-3 rounded-lg border px-3 py-2.5 text-[12px] ${
            canOverrideFloor
              ? "border-signal-amber/40 bg-signal-amber/10 text-signal-amber"
              : "border-signal-red/40 bg-signal-red/10 text-signal-red"
          }`}
        >
          {canOverrideFloor
            ? `Below the ${amount(floor!)} floor price. Applying this records an override against your name.`
            : `Below the ${amount(floor!)} floor price. A manager has to approve this.`}
        </p>
      )}
    </Dialog>
  );
}

// -----------------------------------------------------------------------------

function SaleCompleteDialog({
  result,
  onClose,
}: {
  result: { change: Money.Minor4 } | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={result !== null}
      onClose={onClose}
      title="Sale complete"
      width="sm"
      footer={
        <>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!hasBridge()}
            onClick={onClose}
          >
            <Printer className="size-4" aria-hidden />
            Print receipt
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose} autoFocus>
            Next customer
          </button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4 py-3 text-center">
        <CheckCircle2 className="size-10 text-signal-green" aria-hidden />

        {result && Money.isPositive(result.change) ? (
          <div>
            <div className="eyebrow">Change due</div>
            <div className="num mt-1 text-4xl font-bold text-brass">
              {money(result.change)}
            </div>
          </div>
        ) : (
          <p className="text-[14px] text-zinc-400">Paid in full. No change due.</p>
        )}

        <p className="text-[12px] text-zinc-500">
          Queued for sync. The invoice number is assigned when it reaches the
          server.
        </p>
      </div>
    </Dialog>
  );
}
