import type { PaymentMethod, Permission } from "@devsfleet/shared-types";
import { Money } from "@devsfleet/shared-utils";
import { ArrowLeft, Check, CheckCircle2, FileText, Loader2, Plus, Printer, Search as SearchIcon, UserPlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "../components/Dialog.js";
import { HeldCartsDialog } from "../components/HeldCartsDialog.js";
import { KeyRail, type KeyAction } from "../components/KeyRail.js";
import { ManagerOverrideDialog } from "../components/ManagerOverrideDialog.js";
import { PaymentDialog } from "../components/PaymentDialog.js";
import { ProductSearch } from "../components/ProductSearch.js";
import { ReceiptPanel } from "../components/ReceiptPanel.js";
import { useBarcodeScanner, useHotkeys } from "../lib/keyboard.js";
import { amount, money } from "../lib/money.js";
import { hasBridge, posData, type PosCustomer } from "../lib/pos-data.js";
import {
  scaledFloor,
  scaledListPrice,
  useCart,
  useCartTotals,
  useFloorViolations,
  type CartLine,
} from "../store/cart.js";
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
  const { can, discountCeiling } = useAuth();

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [editing, setEditing] = useState<CartLine | null>(null);
  const [completed, setCompleted] = useState<{
    localId: string;
    change: Money.Minor4;
    hasCustomer: boolean;
  } | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const [scanMiss, setScanMiss] = useState<string | null>(null);
  const [heldOpen, setHeldOpen] = useState(false);
  const [labelling, setLabelling] = useState(false);
  const [label, setLabel] = useState("");

  const empty = cart.lines.length === 0;
  const blocked = violations.length > 0;

  /**
   * Why payment cannot be taken, in the cashier's words rather than as a
   * greyed-out control. A disabled button with no reason on it sends somebody
   * to find a manager to ask why the till "is broken".
   */
  const chargeBlockedReason = empty
    ? "Scan or search for an item first"
    : blocked
      ? "A manager has to approve the flagged line"
      : !cashSessionId
        ? "Open the cash drawer before taking payment"
        : null;

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

  /**
   * F8 parks the cart. An empty till opens the list instead — the cashier
   * pressing it with nothing on screen wants the cart they parked, not to park
   * a cart with no lines in it.
   */
  const hold = useCallback(() => {
    if (empty) {
      setHeldOpen(true);
      return;
    }
    setLabel("");
    setLabelling(true);
  }, [empty]);

  async function park() {
    const cart = useCart.getState();
    await posData.holdCart({
      label: label.trim() || null,
      lineCount: cart.lines.length,
      total: Money.toDecimalString(cart.totals().total, 2),
      customerName: cart.customer?.name ?? null,
      cartData: cart.snapshot(),
    });

    setLabelling(false);
    cart.clear();
    setFocusSignal((n) => n + 1);
  }

  useHotkeys({
    f1: () => setFocusSignal((n) => n + 1),
    f2: () => setCustomerOpen(true),
    f4: charge,
    f7: () => void saveAsQuote(),
    f8: hold,
    escape: () => {
      if (!empty) cart.clear();
    },
  });

  async function completeSale(
    payments: Array<{ method: PaymentMethod; amount: string; reference?: string }>,
    change: Money.Minor4,
  ) {
    const draft = {
      localId: crypto.randomUUID(),
      customerId: cart.customer?.id ?? null,
      cashSessionId,
      lines: cart.lines.map((line, index) => ({
        variantId: line.product.id,
        productName: line.product.name,
        variantName: line.product.variantName ?? "Default",
        productSku: line.product.sku,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountPercent: line.discountPercent,
        taxPercent: line.product.taxPercent,
        // Before-tax and tax, from the same calculation the receipt on
        // screen is already showing — the A4 invoice this sale can print
        // later has to foot to the exact figures the cashier just saw.
        lineSubtotal: Money.toDecimalString(totals.lines[index]?.net ?? 0n, 2),
        taxAmount: Money.toDecimalString(totals.lines[index]?.tax ?? 0n, 2),
        total: Money.toDecimalString(totals.lines[index]?.total ?? 0n, 2),
        ...(line.unit
          ? { unitId: line.unit.unitId, unitConversionFactor: line.unit.conversionFactor }
          : {}),
      })),
      subtotal: Money.toDecimalString(totals.subtotal, 2),
      taxAmount: Money.toDecimalString(totals.taxAmount, 2),
      discountAmount: Money.toDecimalString(totals.discountAmount, 2),
      total: Money.toDecimalString(totals.total, 2),
      payments,
      occurredAt: new Date().toISOString(),
      // The supervisor approvals this cart collected. They travel with the
      // sale because the push may be hours away and goes out on the cashier's
      // session — the server has no other way to know a manager said yes.
      overrideGrants: useCart.getState().overrideGrants,
    };

    /**
     * Writes locally and returns. It does not wait for the network — the
     * customer is standing here and the sale has already happened.
     *
     * It CAN now refuse, though: the local offline stock ceiling blocks a
     * line that would sell past what this terminal actually has synced. The
     * payment dialog stays open on a refusal rather than closing as if the
     * sale went through — the cashier needs to see why and adjust the cart,
     * not discover a missing sale at reconciliation time.
     */
    try {
      await posData.commitSale(draft);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not complete the sale.");
      return;
    }

    setPaymentOpen(false);
    setCompleted({ localId: draft.localId, change, hasCustomer: cart.customer !== null });
    cart.clear();
    setFocusSignal((n) => n + 1);
  }

  async function saveAsQuote() {
    if (empty) return;
    const cartState = useCart.getState();
    if (!cartState.customer) {
      alert("A quotation requires a customer. Please attach a customer first.");
      setCustomerOpen(true);
      return;
    }

    const draft: Parameters<typeof posData.saveQuotation>[0] = {
      localId: crypto.randomUUID(),
      customerId: cartState.customer.id,
      lines: cartState.lines.map((line, index) => ({
        variantId: line.product.id,
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
      occurredAt: new Date().toISOString(),
    };

    await posData.saveQuotation(draft);
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
      combo: "F7",
      label: "Save Quote",
      onPress: () => void saveAsQuote(),
      disabled: empty,
    },
    {
      combo: "F8",
      label: empty ? "Held carts" : "Hold cart",
      onPress: hold,
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
          onCharge={charge}
          chargeBlockedReason={chargeBlockedReason}
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

      <HeldCartsDialog
        open={heldOpen}
        onClose={() => setHeldOpen(false)}
        onRestore={(cartData) => useCart.getState().restore(cartData as never)}
      />

      {/* A label is optional but asked for every time: two unlabelled carts are
          indistinguishable at exactly the moment you need to tell them apart. */}
      <Dialog
        open={labelling}
        onClose={() => setLabelling(false)}
        title="Hold this cart"
        description="Give it a reference name so you can restore it later."
        width="sm"
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setLabelling(false)}
              className="btn btn-ghost flex-1 text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void park()}
              className="btn btn-primary flex-1 text-xs font-bold"
            >
              Hold Cart
            </button>
          </div>
        }
      >
        <input
          autoFocus
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void park();
          }}
          maxLength={80}
          placeholder="e.g. Counter pickup, Blue van"
          className="field text-xs bg-(--pos-raised) border-(--pos-border) text-(--pos-text)"
        />
      </Dialog>

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
          canOverridePrice={can("price:override")}
          discountCeiling={discountCeiling()}
        />
      )}

      {/* Keyed per sale: the dialog mounts fresh so one sale's print state
          can never be showing while the next sale's bill is going out. */}
      <SaleCompleteDialog
        key={completed?.localId ?? "idle"}
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
  const [mode, setMode] = useState<"search" | "create">("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PosCustomer[]>([]);

  // New customer form state
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [trn, setTrn] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback((value: string) => {
    setQuery(value);
    void posData.searchCustomers(value).then(setResults);
  }, []);

  function resetForm() {
    setMode("search");
    setName("");
    setPhone("");
    setCompany("");
    setTrn("");
    setCreditLimit("");
    setError(null);
  }

  function handleOpenCreate(prefillName?: string) {
    setName(prefillName || query || "");
    setError(null);
    setMode("create");
  }

  async function handleCreateCustomer(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please enter a customer name.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const created = await posData.createCustomer({
        name: name.trim(),
        phone: phone.trim() || undefined,
        company: company.trim() || undefined,
        trn: trn.trim() || undefined,
        creditLimit: creditLimit.trim() || undefined,
      });

      resetForm();
      onPick(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create customer.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        resetForm();
        onClose();
      }}
      title={mode === "create" ? "Add new customer" : "Attach a customer"}
      description={
        mode === "create"
          ? "Create a customer profile and attach them to this sale."
          : "Needed for credit sales, wholesale pricing, and VAT invoices."
      }
    >
      {mode === "search" ? (
        <>
          <div className="mb-3 flex items-center gap-2">
            <div className="relative flex-1">
              <SearchIcon
                className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-pos-text-3"
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
            <button
              type="button"
              onClick={() => handleOpenCreate()}
              className="btn btn-primary shrink-0 gap-1.5 px-3 py-2 text-[13px]"
            >
              <UserPlus className="size-4" aria-hidden />
              New
            </button>
          </div>

          <ul className="max-h-[50vh] space-y-1.5 overflow-y-auto">
            {results.map((customer) => {
              const available = Money.subtract(
                Money.toMinor(customer.creditLimit),
                Money.toMinor(customer.creditBalance),
              );
              return (
                <li key={customer.id}>
                  <button
                    type="button"
                    onClick={() => {
                      resetForm();
                      onPick(customer);
                    }}
                    className="flex w-full items-center gap-4 rounded-lg border border-pos-border bg-pos-panel px-3.5 py-3 text-left transition-colors hover:bg-pos-raised"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium text-pos-text">
                        {customer.name}
                      </div>
                      <div className="num mt-0.5 truncate text-[11px] text-pos-text-3">
                        {customer.company ?? customer.phone ?? "No contact details"}
                      </div>
                    </div>
                    {Number(customer.creditLimit) > 0 && (
                      <div className="text-right">
                        <div className="eyebrow">Credit left</div>
                        <div
                          className={`num text-[12px] ${
                            Money.isPositive(available)
                              ? "text-pos-text-2"
                              : "text-signal-red"
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
            {results.length === 0 && (
              <li className="py-8 text-center">
                <p className="text-[13px] text-pos-text-3">
                  {query
                    ? `No customer matches "${query}".`
                    : "No customers found."}
                </p>
                <button
                  type="button"
                  onClick={() => handleOpenCreate(query)}
                  className="btn btn-ghost mt-3 gap-2 text-[13px]"
                >
                  <Plus className="size-4 text-brass" />
                  Add "{query || "New Customer"}"
                </button>
              </li>
            )}
          </ul>
        </>
      ) : (
        <form onSubmit={handleCreateCustomer} className="space-y-3.5">
          {error && (
            <p className="rounded-lg border border-signal-red/30 bg-signal-red/10 px-3.5 py-2 text-[12px] text-signal-red">
              {error}
            </p>
          )}

          <div>
            <label className="eyebrow block">
              Customer Name <span className="text-signal-red">*</span>
            </label>
            <input
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="field mt-1"
              placeholder="e.g. Al Noor Contracting LLC or Ahmed Ali"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="eyebrow block">Phone Number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="field mt-1"
                placeholder="+971 50 123 4567"
              />
            </div>
            <div>
              <label className="eyebrow block">Company</label>
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="field mt-1"
                placeholder="Company name"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="eyebrow block">TRN (Tax Number)</label>
              <input
                value={trn}
                onChange={(e) => setTrn(e.target.value)}
                className="field mt-1"
                placeholder="100XXXXXXXXX003"
              />
            </div>
            <div>
              <label className="eyebrow block">Credit Limit (AED)</label>
              <input
                type="number"
                min="0"
                step="100"
                value={creditLimit}
                onChange={(e) => setCreditLimit(e.target.value)}
                className="field num mt-1"
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2 border-t border-pos-border pt-4">
            <button
              type="button"
              onClick={() => setMode("search")}
              className="btn btn-ghost text-[13px]"
              disabled={saving}
            >
              <ArrowLeft className="size-4" />
              Back to search
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="btn btn-primary text-[13px]"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="size-4" />
                  Save & Attach
                </>
              )}
            </button>
          </div>
        </form>
      )}
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
  canOverridePrice,
  discountCeiling,
}: {
  line: CartLine;
  onClose: () => void;
  canOverrideFloor: boolean;
  canOverridePrice: boolean;
  /** This cashier's own ABAC ceiling, as a decimal string. */
  discountCeiling: string;
}) {
  const { setUnitPrice, setLineDiscount, addOverrideGrant } = useCart();
  const [price, setPrice] = useState(line.unitPrice);
  const [discount, setDiscount] = useState(line.discountPercent);
  const [approving, setApproving] = useState<Permission | null>(null);

  const floor = scaledFloor(line);
  const list = scaledListPrice(line);
  const unit = Money.toMinor(price || "0");
  const effective = Money.subtract(unit, Money.percentOf(unit, discount || "0"));
  const belowFloor = floor !== null && effective < floor;

  /**
   * Undercutting list needs `price:override`, which a cashier role does not
   * carry — and the server enforces the same rule when the sale is pushed.
   *
   * Asking here rather than only at checkout is not a courtesy: the sale is
   * committed locally and the receipt prints before anything reaches the
   * server, so a refusal at push time arrives after the goods have gone. The
   * till is the only place where "no" is still actionable.
   *
   * The line's own price, not the effective one: a discount is a separate
   * control with its own ceiling, checked below.
   */
  const belowList = unit < list;

  /**
   * The discount box gets the same treatment as the price box.
   *
   * `sale:discount` says a cashier may discount at all; `maxDiscountPercent`
   * says how far. The button was gated on the first and not the second, so
   * somebody capped at 5% could type 50%, the receipt printed, and the server
   * refused the sale when it finally pushed. A manager's approval lends THEIR
   * ceiling to the document — see OverrideGrantsService.discountCeiling.
   */
  const overDiscount = Number(discount || "0") > Number(discountCeiling || "0");

  const needed: Permission | null = belowFloor
    ? canOverrideFloor
      ? null
      : "price:override_floor"
    : belowList && !canOverridePrice
      ? "price:override"
      : overDiscount
        ? "sale:discount"
        : null;

  function commit() {
    /**
     * `floorOverridden` means AUTHORISED, not "is below the floor". Reaching
     * here already establishes that: `apply()` diverts to the approval dialog
     * whenever `needed` is set, and only calls this once it clears.
     */
    setUnitPrice(line.key, price, belowFloor);
    setLineDiscount(line.key, discount || "0");
    onClose();
  }

  function apply() {
    if (needed) {
      setApproving(needed);
      return;
    }
    commit();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={line.product.name}
      description={`${line.product.sku}${line.unit ? ` · ${line.unit.unitAbbr}` : ""} · list ${amount(scaledListPrice(line))}`}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={apply}>
            {needed ? "Get approval" : "Apply"}
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

      <div className="mt-4 flex items-baseline justify-between rounded-xl border border-(--pos-border) bg-(--pos-raised) px-3.5 py-3">
        <span className="eyebrow">Effective unit price</span>
        <span
          className={`num font-mono text-lg font-bold ${belowFloor ? "text-signal-red" : "text-(--pos-text)"}`}
        >
          {amount(effective)}
        </span>
      </div>

      {(belowFloor || belowList || overDiscount) && (
        <p
          className={`mt-3 rounded-lg border px-3 py-2.5 text-[12px] ${
            needed
              ? "border-signal-red/40 bg-signal-red/10 text-signal-red"
              : "border-signal-amber/40 bg-signal-amber/10 text-signal-amber"
          }`}
        >
          {overDiscount
            ? `${discount}% is above your ${discountCeiling}% limit. A manager has to approve it.`
            : belowFloor
              ? needed
                ? `Below the ${amount(floor!)} floor price. A manager has to approve this.`
                : `Below the ${amount(floor!)} floor price. Applying this records an override against your name.`
              : needed
                ? `Below the ${amount(list)} list price. A manager has to approve this.`
                : `Below the ${amount(list)} list price. Applying this records an override against your name.`}
        </p>
      )}

      <ManagerOverrideDialog
        open={approving !== null}
        requiredPermission={approving ?? "price:override"}
        onClose={() => setApproving(null)}
        onSuccess={(_managerName, grant) => {
          // The grant is what the server will believe. Recording it before
          // committing the line keeps the two from separating.
          addOverrideGrant(grant);
          setApproving(null);
          commit();
        }}
      />
    </Dialog>
  );
}

// -----------------------------------------------------------------------------

/**
 * What happens after the money is taken.
 *
 * The bill prints itself. A cashier should not have to ask for the thing every
 * customer expects, and the drawer kick for a cash sale rides along with that
 * same print job — so making the print a manual click also made the drawer a
 * manual click.
 *
 * The terminal is wired to one printer of one size, so that size is what
 * prints automatically. A4 is offered alongside it because a wholesale
 * customer asks for a full tax invoice at the counter, and it needs no
 * hardware at all: it renders a PDF and opens it in the OS viewer.
 *
 * A terminal with no printer wired says so instead of reporting a failure it
 * could have predicted — and still offers the A4 copy, which will work.
 */
function SaleCompleteDialog({
  result,
  onClose,
}: {
  result: { localId: string; change: Money.Minor4; hasCustomer: boolean } | null;
  onClose: () => void;
}) {
  const [outcome, setOutcome] = useState<PrintOutcome>({ status: "idle" });
  const [terminalFormat, setTerminalFormat] = useState<string>("thermal_80");
  /** Formats already printed for THIS sale — a second copy is stamped DUPLICATE. */
  const printedFormats = useRef<Set<string>>(new Set());

  const print = useCallback(
    async (format: string) => {
      if (!result) return;
      const reprint = printedFormats.current.has(format);
      setOutcome({ status: "printing", format });
      try {
        await window.devsfleet.printer.printReceipt(result.localId, format, reprint);
        printedFormats.current.add(format);
        setOutcome({ status: "printed", format, reprint });
      } catch (err) {
        setOutcome({
          status: "failed",
          format,
          message: err instanceof Error ? err.message : "Printing failed.",
        });
      }
    },
    [result],
  );

  // Mounted fresh per sale (keyed on localId at the call site), so this runs
  // once per completed sale and never carries the previous one's state.
  useEffect(() => {
    if (!result || !hasBridge()) return;
    let cancelled = false;

    void (async () => {
      try {
        const probe = await window.devsfleet.printer.probe();
        if (cancelled) return;
        setTerminalFormat(probe.format);
        if (!probe.reachable) {
          setOutcome({ status: "no-printer", devicePath: probe.devicePath });
          return;
        }
        await print(probe.format);
      } catch (err) {
        if (!cancelled) {
          setOutcome({
            status: "failed",
            format: "",
            message: err instanceof Error ? err.message : "Could not reach the printer.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [result, print]);

  const busy = outcome.status === "printing";
  // A terminal configured for A4 would otherwise show the same button twice.
  const formats = terminalFormat === "a4" ? ["a4"] : [terminalFormat, "a4"];

  return (
    <Dialog
      open={result !== null}
      onClose={onClose}
      title="Sale complete"
      // Wide enough for the two bill formats and "Next customer" to sit on one
      // row — a wrapped "80mm / receipt" reads as two controls at a glance.
      width="md"
      footer={
        <>
          {formats.map((format) => (
            <button
              key={format}
              type="button"
              className="btn btn-ghost"
              disabled={!hasBridge() || busy}
              onClick={() => void print(format)}
            >
              {format === "a4" ? (
                <FileText className="size-4" aria-hidden />
              ) : (
                <Printer className="size-4" aria-hidden />
              )}
              {outcome.status === "printing" && outcome.format === format
                ? "Printing..."
                : printedFormats.current.has(format)
                  ? `Reprint ${formatLabel(format)}`
                  : formatLabel(format)}
            </button>
          ))}
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
            <div className="num font-mono mt-1 text-4xl font-bold text-(--pos-accent)">
              {money(result.change)}
            </div>
          </div>
        ) : (
          <p className="text-xs font-medium text-(--pos-text-2)">Paid in full. No change due.</p>
        )}

        <PrintStatus outcome={outcome} />

        <p className="text-[11px] text-(--pos-text-3)">
          Queued for sync. The invoice number is assigned when it reaches the
          server.
        </p>
      </div>
    </Dialog>
  );
}

type PrintOutcome =
  | { status: "idle" }
  | { status: "printing"; format: string }
  | { status: "printed"; format: string; reprint: boolean }
  | { status: "failed"; format: string; message: string }
  | { status: "no-printer"; devicePath: string };

function formatLabel(format: string): string {
  if (format === "a4") return "A4 Tax Invoice";
  if (format === "thermal_58") return "58mm Receipt";
  if (format === "thermal_80") return "80mm Receipt";
  return format;
}

function PrintStatus({ outcome }: { outcome: PrintOutcome }) {
  switch (outcome.status) {
    case "printing":
      return (
        <p className="flex items-center gap-2 text-xs text-(--pos-text-3)">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Printing {formatLabel(outcome.format)}…
        </p>
      );
    case "printed":
      return (
        <p className="text-xs font-semibold text-signal-green">
          {formatLabel(outcome.format)} printed{outcome.reprint ? " (DUPLICATE)" : ""}.
        </p>
      );
    case "failed":
      return (
        <p className="rounded-xl border border-signal-red/30 bg-signal-red/10 p-2.5 text-xs text-signal-red font-medium">
          {outcome.message}
        </p>
      );
    case "no-printer":
      return (
        <p className="rounded-xl border border-signal-amber/30 bg-signal-amber/10 p-2.5 text-xs text-signal-amber font-medium">
          No thermal printer found at <span className="font-mono">{outcome.devicePath}</span>. Check Settings or print A4 invoice.
        </p>
      );
    default:
      return null;
  }
}
