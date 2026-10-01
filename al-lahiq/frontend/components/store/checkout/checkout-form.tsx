"use client";

import type {
  Address,
  AddressInput,
  CheckoutQuote,
  DeliveryMethod,
  Emirate,
  PaymentMethod,
  PlaceOrderInput,
  PlaceOrderResult,
} from "@al-lahiq/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Store, Truck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Checkbox, FormError, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty";
import { track } from "@/lib/analytics";
import { api, ApiError, errorMessage } from "@/lib/api-browser";
import { cn } from "@/lib/cn";
import { EMIRATES, emirateName, uomCount } from "@/lib/format";
import { useCart, useMe } from "@/lib/hooks/store";

const emptyAddress: AddressInput = { fullName: "", phone: "", emirate: "DUBAI", area: "", street: "", building: "", landmark: "" };

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-panel)] border border-galv bg-paper p-5" aria-labelledby={`step-${n}`}>
      <h2 id={`step-${n}`} className="mb-4 flex items-center gap-3 text-2xl">
        <span className="inline-flex size-7 items-center justify-center rounded-full bg-ink font-cond text-base text-white" aria-hidden>
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Choice({ checked, onChange, name, children, disabled }: { checked: boolean; onChange: () => void; name: string; children: ReactNode; disabled?: boolean }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-[var(--radius-tag)] border p-3",
        checked ? "border-pipe bg-pipe-tint" : "border-galv hover:border-steel-light",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} disabled={disabled} className="mt-1 accent-[var(--color-pipe)]" />
      <span className="flex-1">{children}</span>
    </label>
  );
}

export function CheckoutForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: cart, isLoading: cartLoading } = useCart();

  const [contact, setContact] = useState({ fullName: "", email: "", phone: "" });
  // User choices; null means "not chosen yet, use the default".
  const [chosenMethod, setMethod] = useState<DeliveryMethod | null>(null);
  const [chosenAddressId, setAddressId] = useState<string | null>(null);
  const [address, setAddress] = useState<AddressInput>(emptyAddress);
  const [saveAddress, setSaveAddress] = useState(true);
  const [chosenBranchId, setBranchId] = useState<string | null>(null);
  const [chosenSlot, setSlot] = useState<string>("");
  const [business, setBusiness] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [trn, setTrn] = useState("");
  const [chosenPayment, setPayment] = useState<PaymentMethod | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(params.get("cancelled") ? "Payment was not completed. You can try again or choose another payment method." : null);
  const [placing, setPlacing] = useState(false);

  const { data: addresses } = useQuery({
    queryKey: ["addresses"],
    queryFn: () => api.get<Address[]>("/me/addresses"),
    enabled: !!me,
  });

  // Prefill from the account once it loads.
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null);
  if (me && prefilledFor !== me.id) {
    setPrefilledFor(me.id);
    setContact((c) => ({
      fullName: c.fullName || `${me.firstName} ${me.lastName}`,
      email: c.email || me.email,
      phone: c.phone || me.phone || "",
    }));
    if (me.companyName || me.trn) {
      setBusiness(true);
      setCompanyName((v) => v || me.companyName || "");
      setTrn((v) => v || me.trn || "");
    }
  }
  const addressId = chosenAddressId ?? (addresses?.find((a) => a.isDefault) ?? addresses?.[0])?.id ?? "new";

  const savedAddress = addresses?.find((a) => a.id === addressId);
  const [lastQuoteMethod, setLastQuoteMethod] = useState<DeliveryMethod | null>(null);
  const method = chosenMethod ?? lastQuoteMethod;
  const branchId = chosenBranchId;
  const emirate: Emirate | undefined = addressId !== "new" ? savedAddress?.emirate : address.emirate;

  const quoteKey = ["checkout-quote", method, emirate, branchId, cart?.couponCode, cart?.items.map((i) => `${i.id}:${i.quantity}`).join()];
  const { data: quote, refetch: refetchQuote } = useQuery({
    queryKey: quoteKey,
    queryFn: () =>
      api.post<CheckoutQuote>("/checkout/quote", {
        deliveryMethod: method ?? undefined,
        emirate,
        pickupBranchId: method === "PICKUP" ? (branchId ?? undefined) : undefined,
      }),
    enabled: !!cart && cart.items.length > 0,
    placeholderData: (prev) => prev,
  });
  if (quote && !lastQuoteMethod) setLastQuoteMethod(quote.deliveryMethod);

  // Defaults come from the quote (e.g. pickup-only items → pickup).
  const branch = quote?.pickupBranches.find((b) => b.id === branchId) ?? quote?.pickupBranches[0];
  const slot = branch?.slots.some((s) => s.start === chosenSlot) ? chosenSlot : (branch?.slots[0]?.start ?? "");
  const availablePayments = quote?.paymentMethods.filter((p) => p.available) ?? [];
  const payment = availablePayments.some((p) => p.method === chosenPayment) ? chosenPayment : (availablePayments[0]?.method ?? null);

  const courierBlocked = method === "COURIER" && quote && !quote.courier.available && quote.courier.reason !== "NO_ADDRESS";
  const courierMessage = useMemo(() => {
    switch (quote?.courier.reason) {
      case "PICKUP_ONLY_ITEMS":
        return "Some items in your cart are store pickup only, so this order can't go by courier.";
      case "OVERWEIGHT":
        return `This order weighs about ${quote.weightKg} kg, over the courier limit. Choose store pickup.`;
      case "EMIRATE_NOT_SERVED":
        return "We don't deliver to this emirate yet. Choose store pickup.";
      default:
        return null;
    }
  }, [quote]);

  if (cartLoading) return <div className="mx-auto max-w-7xl px-4 py-12 text-steel">Loading checkout…</div>;
  if (!cart || cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <EmptyState title="Your cart is empty" action={<ButtonLink href="/">Continue shopping</ButtonLink>} />
      </div>
    );
  }

  const place = async () => {
    setError(null);
    if (!method || !payment || !quote) return;
    const body: PlaceOrderInput = {
      deliveryMethod: method,
      paymentMethod: payment,
      contact,
      expectedTotalFils: quote.totals.total.fils,
      notes: notes || undefined,
      ...(business ? { companyName: companyName || undefined, trn: trn.replace(/\s/g, "") || undefined } : {}),
      ...(method === "COURIER"
        ? addressId !== "new"
          ? { addressId }
          : { address: { ...address, fullName: address.fullName || contact.fullName, phone: address.phone || contact.phone }, saveAddress: !!me && saveAddress }
        : { pickupBranchId: branch?.id, pickupSlotStart: slot || undefined }),
    };
    setPlacing(true);
    track("begin_checkout", {
      value: quote.totals.total.fils / 100,
      items: cart.items.map((i) => ({ item_id: i.sku, item_name: i.productName, price: (i.unitPrice?.fils ?? 0) / 100, quantity: i.quantity })),
    });
    try {
      const result = await api.post<PlaceOrderResult>("/checkout/place", body);
      qc.removeQueries({ queryKey: ["cart"] });
      if (result.next.type === "redirect") {
        window.location.assign(result.next.url);
        return;
      }
      router.push(`/checkout/success?order=${result.trackingToken}`);
    } catch (err) {
      if (err instanceof ApiError && ["PRICE_CHANGED", "TOTAL_CHANGED", "OUT_OF_STOCK", "ITEM_UNAVAILABLE"].includes(err.code)) {
        await Promise.all([qc.invalidateQueries({ queryKey: ["cart"] }), refetchQuote()]);
        setError(
          err.code === "OUT_OF_STOCK"
            ? `${err.message}. Please update your cart.`
            : "Prices changed since you added these items. We've updated your total. Check it and place the order again.",
        );
      } else {
        setError(errorMessage(err));
      }
      setPlacing(false);
    }
  };

  const setAddr = (k: keyof AddressInput) => (e: { target: { value: string } }) => setAddress((a) => ({ ...a, [k]: e.target.value }));

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="text-4xl">Checkout</h1>
      {!me && (
        <p className="mt-2 text-steel">
          Have an account?{" "}
          <Link href="/login?next=/checkout" className="font-semibold text-pipe hover:underline">
            Log in
          </Link>{" "}
          for saved addresses and trade prices, or check out as a guest.
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Step n={1} title="Your details">
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField label="Full name" autoComplete="name" value={contact.fullName} onChange={(e) => setContact({ ...contact, fullName: e.target.value })} required />
              <TextField label="Email" type="email" autoComplete="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} required />
              <TextField label="Mobile" type="tel" autoComplete="tel" placeholder="+971 50 123 4567" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} required hint="For delivery and order updates" />
            </div>
          </Step>

          <Step n={2} title="Delivery">
            <div className="grid gap-3 sm:grid-cols-2">
              <Choice name="method" checked={method === "COURIER"} onChange={() => setMethod("COURIER")} disabled={quote?.courier.reason === "PICKUP_ONLY_ITEMS"}>
                <span className="flex items-center gap-2 font-semibold">
                  <Truck className="size-5" aria-hidden /> Courier delivery
                </span>
                <span className="text-sm text-steel">
                  {quote?.courier.reason === "PICKUP_ONLY_ITEMS" ? "Not available for this cart" : "To your door, usually in 1–3 working days"}
                </span>
              </Choice>
              <Choice name="method" checked={method === "PICKUP"} onChange={() => setMethod("PICKUP")}>
                <span className="flex items-center gap-2 font-semibold">
                  <Store className="size-5" aria-hidden /> Store pickup
                </span>
                <span className="text-sm text-steel">Free. Ready in about 2 hours.</span>
              </Choice>
            </div>

            {method === "COURIER" && (
              <div className="mt-5 space-y-4">
                {addresses && addresses.length > 0 && (
                  <div className="space-y-2">
                    {addresses.map((a) => (
                      <Choice key={a.id} name="address" checked={addressId === a.id} onChange={() => setAddressId(a.id)}>
                        <span className="font-medium">{a.label ?? a.fullName}</span>
                        <span className="block text-sm text-steel">
                          {[a.building, a.street, a.area, emirateName(a.emirate)].filter(Boolean).join(", ")}
                        </span>
                      </Choice>
                    ))}
                    <Choice name="address" checked={addressId === "new"} onChange={() => setAddressId("new")}>
                      <span className="font-medium">Use a new address</span>
                    </Choice>
                  </div>
                )}
                {addressId === "new" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <SelectField label="Emirate" value={address.emirate} onChange={(e) => setAddress({ ...address, emirate: e.target.value as Emirate })}>
                      {EMIRATES.map((e) => (
                        <option key={e.value} value={e.value}>
                          {e.label}
                        </option>
                      ))}
                    </SelectField>
                    <TextField label="Area" placeholder="e.g. Al Barsha 2" value={address.area} onChange={setAddr("area")} required />
                    <TextField label="Street" value={address.street} onChange={setAddr("street")} required />
                    <TextField label="Building / villa / office" value={address.building ?? ""} onChange={setAddr("building")} />
                    <TextField label="Nearest landmark" className="sm:col-span-2" value={address.landmark ?? ""} onChange={setAddr("landmark")} hint="Helps the driver find you" />
                    {me && <Checkbox label="Save this address to my account" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} />}
                  </div>
                )}
                {courierBlocked && courierMessage && <FormError message={courierMessage} />}
                {quote?.courier.available && (
                  <p className="text-[15px]">
                    Delivery to {emirateName(emirate)}:{" "}
                    <strong>{quote.courier.feeNetFils === 0 ? "Free" : quote.courier.fee.formatted}</strong>, usually {quote.courier.etaDays}{" "}
                    {quote.courier.etaDays === 1 ? "working day" : "working days"}.
                    {quote.courier.freeOverFils && quote.courier.feeNetFils > 0 && (
                      <span className="text-steel"> Free on orders over AED {((quote.courier.freeOverFils * 1.05) / 100).toFixed(0)}.</span>
                    )}
                  </p>
                )}
              </div>
            )}

            {method === "PICKUP" && quote && (
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  {quote.pickupBranches.map((b) => (
                    <Choice key={b.id} name="branch" checked={branch?.id === b.id} onChange={() => setBranchId(b.id)}>
                      <span className="font-medium">{b.name}</span>
                      <span className="block text-sm text-steel">{b.address}</span>
                    </Choice>
                  ))}
                </div>
                {branch && (
                  <SelectField label="Pickup time" value={slot} onChange={(e) => setSlot(e.target.value)}>
                    {branch.slots.map((s) => (
                      <option key={s.start} value={s.start}>
                        {s.label}
                      </option>
                    ))}
                  </SelectField>
                )}
              </div>
            )}
          </Step>

          <Step n={3} title="Tax invoice">
            <Checkbox label="I need the invoice in my company's name" checked={business} onChange={(e) => setBusiness(e.target.checked)} />
            {business && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <TextField label="Company name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
                <TextField label="TRN" inputMode="numeric" placeholder="100XXXXXXXXXXXX" value={trn} onChange={(e) => setTrn(e.target.value)} hint="15 digits, starting with 100" />
              </div>
            )}
          </Step>

          <Step n={4} title="Payment">
            <div className="grid gap-2 sm:grid-cols-2">
              {quote?.paymentMethods.map((p) => (
                <Choice key={p.method} name="payment" checked={payment === p.method} onChange={() => setPayment(p.method)} disabled={!p.available}>
                  <span className="font-medium">{p.label}</span>
                  {p.reason && <span className="block text-sm text-steel">{p.reason}</span>}
                </Choice>
              ))}
            </div>
            <TextAreaField className="mt-4" label="Notes for the order (optional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </Step>
        </div>

        <aside className="h-fit space-y-4 rounded-[var(--radius-panel)] border border-galv bg-paper p-5 lg:sticky lg:top-40">
          <h2 className="text-2xl">Your order</h2>
          <ul className="space-y-2 text-[15px]">
            {cart.items.map((i) => (
              <li key={i.id} className="flex justify-between gap-3">
                <span className="min-w-0">
                  <span className="line-clamp-1">{i.productName}</span>
                  <span className="text-sm text-steel">
                    {uomCount(i.quantity, i.uom)}
                    {i.variantName && i.variantName !== i.productName ? `, ${i.variantName}` : ""}
                  </span>
                </span>
                <span className="shrink-0">{i.lineTotal?.formatted}</span>
              </li>
            ))}
          </ul>
          {quote && (
            <dl className="space-y-2 border-t border-galv pt-3 text-[15px]">
              <div className="flex justify-between">
                <dt className="text-steel">Items (excl. VAT)</dt>
                <dd>{quote.totals.subtotalNet.formatted}</dd>
              </div>
              {quote.totals.discountNet.fils > 0 && (
                <div className="flex justify-between text-pipe">
                  <dt>Discount {quote.couponCode}</dt>
                  <dd>−{quote.totals.discountNet.formatted}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-steel">Delivery (excl. VAT)</dt>
                <dd>{method === "PICKUP" || quote.totals.shippingNet.fils === 0 ? "Free" : quote.totals.shippingNet.formatted}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-steel">VAT 5%</dt>
                <dd>{quote.totals.vat.formatted}</dd>
              </div>
              <div className="flex items-baseline justify-between border-t border-galv pt-3">
                <dt className="font-semibold">Total</dt>
                <dd className="tag-price text-3xl">{quote.totals.total.formatted}</dd>
              </div>
            </dl>
          )}
          {quote?.issues.filter((i) => i.code !== "PRICE_CHANGED").map((i) => <FormError key={`${i.code}${i.sku}`} message={i.message} />)}
          <FormError message={error} />
          <Button
            size="lg"
            className="w-full"
            onClick={place}
            loading={placing}
            disabled={!quote || !payment || !method || !!courierBlocked || !contact.fullName || !contact.email || !contact.phone}
          >
            <Lock className="size-4" aria-hidden />
            {payment === "COD" ? "Place order" : "Place order and pay"}
          </Button>
          <p className="text-sm text-steel">
            By placing your order you agree to our{" "}
            <Link href="/pages/terms" className="underline">
              terms
            </Link>
            . Card payments are handled by our payment provider; we never see your card number.
          </p>
        </aside>
      </div>
    </div>
  );
}
