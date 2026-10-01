"use client";

import type { CartItem } from "@al-lahiq/api-client";
import { AlertTriangle, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { FormError } from "@/components/ui/field";
import { ProductImage } from "@/components/ui/product-image";
import { QtyInput } from "@/components/ui/qty-input";
import { errorMessage } from "@/lib/api-browser";
import { uomShort } from "@/lib/format";
import { useCart, useCartActions } from "@/lib/hooks/store";

function Line({ item }: { item: CartItem }) {
  const { update, remove } = useCartActions();
  const [error, setError] = useState<string | null>(null);
  const change = async (quantity: number) => {
    setError(null);
    try {
      await update.mutateAsync({ id: item.id, quantity });
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <li className="grid grid-cols-[72px_1fr] gap-4 py-4 sm:grid-cols-[96px_1fr_auto]">
      <Link href={`/product/${item.productSlug}`} className="block overflow-hidden rounded-[var(--radius-tag)] border border-galv">
        <ProductImage image={item.imageUrl ? { url: item.imageUrl, alt: item.productName } : null} name={item.productName} sizes="96px" />
      </Link>
      <div className="min-w-0">
        <Link href={`/product/${item.productSlug}`} className="font-medium hover:underline">
          {item.productName}
        </Link>
        {item.variantName && item.variantName !== item.productName && <p className="text-sm text-steel">{item.variantName}</p>}
        <p className="text-sm text-steel">SKU {item.sku}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {item.pickupOnly && <Badge>Store pickup only</Badge>}
          {item.priceChanged && <Badge tone="brass">Price updated</Badge>}
          {!item.available && <Badge tone="signal">No longer available</Badge>}
        </div>
        {item.nextTier && (
          <p className="mt-2 text-sm text-[#7a5a0c]">
            Buy {item.nextTier.minQty} {uomShort(item.uom)} or more to pay {item.nextTier.unitPrice.formatted} each.
          </p>
        )}
        <div className="mt-3 flex items-center gap-3 sm:hidden">
          <QtyInput value={item.quantity} onChange={change} uom={item.uom} size="sm" disabled={update.isPending} />
        </div>
        <FormError message={error} />
      </div>
      <div className="col-span-2 flex items-center justify-between gap-6 sm:col-span-1 sm:flex-col sm:items-end sm:justify-start">
        <div className="hidden sm:block">
          <QtyInput value={item.quantity} onChange={change} uom={item.uom} size="sm" disabled={update.isPending} />
        </div>
        <div className="text-right">
          {item.lineTotal && <p className="tag-price text-2xl">{item.lineTotal.formatted}</p>}
          {item.unitPrice && (
            <p className="text-sm text-steel">
              {item.unitPrice.formatted} / {uomShort(item.uom)}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => remove.mutate(item.id)}
          className="inline-flex items-center gap-1 text-sm text-steel hover:text-signal"
        >
          <Trash2 className="size-4" aria-hidden /> Remove
        </button>
      </div>
    </li>
  );
}

function Coupon({ code, error }: { code: string | null; error: string | null }) {
  const { applyCoupon, removeCoupon } = useCartActions();
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  if (code) {
    return (
      <div className="flex items-center justify-between gap-2 text-[15px]">
        <span>
          Promo code <strong>{code}</strong>
          {error && <span className="block text-sm text-signal">{error}</span>}
        </span>
        <button type="button" onClick={() => removeCoupon.mutate()} className="text-sm text-steel hover:text-signal">
          Remove
        </button>
      </div>
    );
  }
  return (
    <form
      className="flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setMessage(null);
        try {
          await applyCoupon.mutateAsync(value);
          setValue("");
        } catch (err) {
          setMessage(errorMessage(err));
        }
      }}
    >
      <label className="sr-only" htmlFor="coupon">
        Promo code
      </label>
      <input
        id="coupon"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Promo code"
        className="h-10 flex-1 rounded-[var(--radius-tag)] border border-galv bg-paper px-3 uppercase placeholder:normal-case"
      />
      <Button type="submit" variant="secondary" loading={applyCoupon.isPending} disabled={!value.trim()}>
        Apply
      </Button>
      {message && <p className="sr-only" role="alert">{message}</p>}
      {message && <p className="basis-full text-sm text-signal">{message}</p>}
    </form>
  );
}

export function CartPage() {
  const { data: cart, isLoading } = useCart();

  if (isLoading) {
    return <div className="mx-auto max-w-7xl px-4 py-12 text-steel">Loading your cart…</div>;
  }
  if (!cart || cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <EmptyState title="Your cart is empty" action={<ButtonLink href="/">Start shopping</ButtonLink>}>
          Search by product name, brand or SKU, or browse by department.
        </EmptyState>
      </div>
    );
  }

  const blocking = cart.issues.filter((i) => i.code === "OUT_OF_STOCK" || i.code === "UNAVAILABLE");
  const notices = cart.issues.filter((i) => i.code === "PRICE_CHANGED" || i.code === "PICKUP_ONLY_ITEMS");

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="text-4xl">Your cart</h1>
      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_360px]">
        <section aria-label="Items">
          {[...blocking, ...notices].length > 0 && (
            <ul className="mb-4 space-y-2">
              {[...blocking, ...notices].map((i, n) => (
                <li
                  key={`${i.code}-${i.sku ?? n}`}
                  className={`flex items-start gap-2 rounded-[var(--radius-tag)] px-3 py-2 text-[15px] ${blocking.includes(i) ? "bg-signal-tint text-signal" : "bg-brass-tint text-[#7a5a0c]"}`}
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {i.message}
                </li>
              ))}
            </ul>
          )}
          <ul className="divide-y divide-galv rounded-[var(--radius-panel)] border border-galv bg-paper px-4">
            {cart.items.map((item) => (
              <Line key={item.id} item={item} />
            ))}
          </ul>
        </section>

        <aside className="h-fit space-y-4 rounded-[var(--radius-panel)] border border-galv bg-paper p-5 lg:sticky lg:top-40">
          <h2 className="text-2xl">Order summary</h2>
          <dl className="space-y-2 text-[15px]">
            <div className="flex justify-between">
              <dt className="text-steel">Items (excl. VAT)</dt>
              <dd>{cart.totals.subtotalNet.formatted}</dd>
            </div>
            {cart.totals.discountNet.fils > 0 && (
              <div className="flex justify-between text-pipe">
                <dt>Discount</dt>
                <dd>−{cart.totals.discountNet.formatted}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-steel">VAT 5%</dt>
              <dd>{cart.totals.vat.formatted}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-steel">Delivery</dt>
              <dd className="text-steel">{cart.freeShipping ? "Free" : "Calculated at checkout"}</dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-galv pt-3">
              <dt className="font-semibold">Total</dt>
              <dd className="tag-price text-3xl">{cart.totals.total.formatted}</dd>
            </div>
          </dl>
          <Coupon code={cart.couponCode} error={cart.couponError} />
          <ButtonLink href="/checkout" size="lg" className={`w-full ${blocking.length ? "pointer-events-none opacity-50" : ""}`} aria-disabled={blocking.length > 0}>
            Go to checkout
          </ButtonLink>
          {blocking.length > 0 && <p className="text-sm text-signal">Change or remove the items marked above to continue.</p>}
          <p className="text-sm text-steel">Tax invoice with our TRN included. Add your company TRN at checkout.</p>
        </aside>
      </div>
    </div>
  );
}
