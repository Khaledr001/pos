"use client";

import type { PriceMap, PriceView, ProductDetail } from "@devsfleet/storefront-client";
import { useQuery } from "@tanstack/react-query";
import { Store, Truck } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { StockBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { PriceTag } from "@/components/ui/price-tag";
import { QtyInput } from "@/components/ui/qty-input";
import { track } from "@/lib/analytics";
import { api, errorMessage } from "@/lib/api-browser";
import { cn } from "@/lib/cn";
import { formatQty, uomCount, uomShort } from "@/lib/format";
import { useCartActions, useMe } from "@/lib/hooks/store";
import { SaveToList } from "./save-to-list";
import { TileCalculator } from "./tile-calculator";

const AXIS_LABELS: Record<string, string> = { size: "Size", colour: "Colour", finish: "Finish", capacity: "Capacity", wattage: "Wattage", rating: "Rating", poles: "Poles" };

export function BuyBox({ product }: { product: ProductDetail }) {
  const { data: me } = useMe();
  const { add } = useCartActions();
  const [selected, setSelected] = useState<Record<string, string>>(() => ({ ...product.variants[0].options }));
  const variant = useMemo(
    () =>
      product.variants.find((v) => product.optionAxes.every((a) => v.options[a.code] === selected[a.code])) ??
      product.variants.find((v) => product.optionAxes.every((a) => !selected[a.code] || v.options[a.code] === selected[a.code])) ??
      product.variants[0],
    [product, selected],
  );
  const [uom, setUom] = useState(variant.units[0]?.uom ?? variant.baseUom);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Trade customers get their own prices; public prices are in the page.
  const { data: personal } = useQuery({
    queryKey: ["prices", product.slug, me?.id],
    queryFn: () => api.get<PriceMap>(`/catalog/prices?skus=${product.variants.map((v) => v.sku).join(",")}`),
    enabled: me?.type === "TRADE",
  });

  const unit = variant.units.find((u) => u.uom === uom) ?? variant.units[0];
  const price: PriceView | undefined = personal?.[variant.sku]?.find((u) => u.uom === unit?.uom)?.price ?? unit?.price;
  const tier = price ? [...price.tiers].reverse().find((t) => t.minQty <= qty) : undefined;
  const unitPrice = tier?.unit ?? price?.unit;
  const unitNet = tier?.unitNet ?? price?.unitNet;
  const out = variant.availability.label === "OUT_OF_STOCK";
  const boxUnit = variant.baseUom === "sqm" ? variant.units.find((u) => u.uom === "box") : undefined;

  const choose = (axis: string, value: string) => {
    setSelected((s) => ({ ...s, [axis]: value }));
    setAdded(null);
  };

  const available = (axis: string, value: string) =>
    product.variants.some(
      (v) => v.options[axis] === value && product.optionAxes.every((a) => a.code === axis || !selected[a.code] || v.options[a.code] === selected[a.code]),
    );

  const onAdd = async () => {
    setError(null);
    try {
      await add.mutateAsync({ variantId: variant.id, uom: unit?.uom, quantity: qty });
      track("add_to_cart", {
        // Analytics estimate only; never shown to the shopper.
        value: ((unitPrice?.fils ?? 0) * qty) / 100,
        items: [{ item_id: variant.sku, item_name: product.name, price: (unitPrice?.fils ?? 0) / 100, quantity: qty }],
      });
      setAdded(`${uomCount(qty, unit?.uom ?? variant.baseUom)} added to your cart`);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="space-y-5">
      {product.optionAxes.map((axis) => (
        <fieldset key={axis.code}>
          <legend className="mb-2 text-sm font-medium">
            {AXIS_LABELS[axis.code] ?? axis.code}: <span className="text-steel">{selected[axis.code]}</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {axis.values.map((value) => {
              const active = selected[axis.code] === value;
              const possible = available(axis.code, value);
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => choose(axis.code, value)}
                  className={cn(
                    "h-10 min-w-12 rounded-[var(--radius-tag)] border px-3 text-[15px]",
                    active ? "border-ink bg-ink text-white" : "border-galv bg-paper hover:border-steel-light",
                    !possible && !active && "text-steel-light line-through decoration-steel-light/60",
                  )}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}

      <div className="rounded-[var(--radius-panel)] border border-galv bg-paper p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {price && unitPrice ? (
            <div>
              <PriceTag price={unitPrice} uom={unit?.uom} was={price.discounted || tier ? price.retailUnit : null} size="xl" />
              <p className="mt-1 text-sm text-steel">
                Incl. {Number(product.taxPercent)}% VAT{unitNet ? `, ${unitNet.formatted} excl. VAT` : ""}
                {price.priceListType === "TRADE" && <span className="ml-2 font-semibold text-[#7a5a0c]">Your trade price</span>}
                {price.priceListType === "PROMO" && <span className="ml-2 font-semibold text-[#7a5a0c]">Online offer</span>}
              </p>
            </div>
          ) : (
            <p className="text-steel">This option isn&apos;t sold online. Ask us on WhatsApp for a price.</p>
          )}
          <StockBadge label={variant.availability.label} />
        </div>

        {price && price.tiers.length > 1 && (
          <table className="mt-4 w-full text-[15px]">
            <caption className="mb-1 text-left text-sm font-medium">Buy more, pay less</caption>
            <tbody>
              {price.tiers.map((t, i) => {
                const next = price.tiers[i + 1];
                const activeTier = qty >= t.minQty && (!next || qty < next.minQty);
                return (
                  <tr key={t.minQty} className={cn("border-t border-galv", activeTier && "bg-pipe-tint")}>
                    <td className="py-1.5 pl-2">
                      {i === 0 ? "Any quantity" : `From ${formatQty(t.minQty)} ${uomShort(unit?.uom ?? "")}`}
                    </td>
                    <td className="py-1.5 pr-2 text-right font-cond text-lg font-semibold">{t.unit.formatted}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {variant.units.length > 1 && (
          <fieldset className="mt-4">
            <legend className="mb-2 text-sm font-medium">Buy by</legend>
            <div className="flex flex-wrap gap-2">
              {variant.units.map((u) => (
                <button
                  key={u.uom}
                  type="button"
                  aria-pressed={u.uom === unit?.uom}
                  onClick={() => {
                    setUom(u.uom);
                    setQty(1);
                  }}
                  className={cn(
                    "rounded-[var(--radius-tag)] border px-3 py-1.5 text-left text-[15px]",
                    u.uom === unit?.uom ? "border-ink bg-ink text-white" : "border-galv bg-paper hover:border-steel-light",
                  )}
                >
                  <span className="font-semibold">{uomShort(u.uom)}</span>
                  {u.factor !== 1 && (
                    <span className={u.uom === unit?.uom ? "text-white/75" : "text-steel"}>
                      {" "}
                      ({formatQty(u.factor)} {uomShort(variant.baseUom)})
                    </span>
                  )}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <QtyInput value={qty} onChange={setQty} uom={unit?.uom ?? variant.baseUom} />
          <Button size="lg" className="flex-1 min-w-48" onClick={onAdd} loading={add.isPending} disabled={!price || out}>
            {/* No total here: VAT rounds per line, so shelf price x quantity can be a fils off the cart's own figure. */}
            {out ? "Out of stock" : qty > 1 ? `Add ${qty} to cart` : "Add to cart"}
          </Button>
          <SaveToList
            variantId={variant.id}
            uom={unit?.uom}
            quantity={qty}
            onDone={(message, err) => {
              setAdded(message);
              setError(err ?? null);
            }}
          />
        </div>
        <div className="mt-3 space-y-2" aria-live="polite">
          {added && (
            <p className="flex flex-wrap items-center gap-3 rounded-[var(--radius-tag)] bg-pipe-tint px-3 py-2 text-[15px] text-pipe-dark">
              {added}
              {added.endsWith("cart") ? (
                <Link href="/cart" className="font-semibold underline">
                  View cart
                </Link>
              ) : (
                <Link href="/account/lists" className="font-semibold underline">
                  View lists
                </Link>
              )}
            </p>
          )}
          <FormError message={error} />
        </div>

        <ul className="mt-4 space-y-2 border-t border-galv pt-4 text-[15px]">
          <li className="flex gap-2">
            <Truck className="mt-0.5 size-5 shrink-0 text-steel" aria-hidden />
            {product.pickupOnly ? (
              <span>
                <strong>Store pickup only</strong> — too heavy or bulky for courier delivery.
              </span>
            ) : (
              <span>Courier delivery to all emirates, fee shown at checkout.</span>
            )}
          </li>
          <li className="flex gap-2">
            <Store className="mt-0.5 size-5 shrink-0 text-steel" aria-hidden />
            <span>
              Pickup:{" "}
              {variant.availability.branches.length
                ? variant.availability.branches.map((b, i) => (
                    <span key={b.code}>
                      {i > 0 && ", "}
                      {b.name} <span className={b.label === "OUT_OF_STOCK" ? "text-signal" : "text-pipe"}>({b.label === "OUT_OF_STOCK" ? "none" : b.label === "LOW_STOCK" ? "low" : "in stock"})</span>
                    </span>
                  ))
                : "ask us about availability"}
            </span>
          </li>
        </ul>
      </div>

      {boxUnit && (
        <TileCalculator
          boxArea={boxUnit.factor}
          onUse={(boxes) => {
            setUom("box");
            setQty(boxes);
          }}
        />
      )}

      <p className="text-sm text-steel">SKU {variant.sku}</p>
    </div>
  );
}
