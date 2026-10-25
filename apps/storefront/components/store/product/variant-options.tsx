"use client";

import type { ProductDetail } from "@devsfleet/storefront-client";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";

const AXIS_LABELS: Record<string, string> = { size: "Size", colour: "Colour", finish: "Finish", capacity: "Capacity", wattage: "Wattage", rating: "Rating", poles: "Poles" };

/** Which variant the shopper's option choices point at; shared by the buy box and the enquiry box. */
export function useVariantSelection(product: ProductDetail) {
  const [selected, setSelected] = useState<Record<string, string>>(() => ({ ...product.variants[0].options }));
  const variant = useMemo(
    () =>
      product.variants.find((v) => product.optionAxes.every((a) => v.options[a.code] === selected[a.code])) ??
      product.variants.find((v) => product.optionAxes.every((a) => !selected[a.code] || v.options[a.code] === selected[a.code])) ??
      product.variants[0],
    [product, selected],
  );
  const choose = (axis: string, value: string) => setSelected((s) => ({ ...s, [axis]: value }));
  const available = (axis: string, value: string) =>
    product.variants.some(
      (v) => v.options[axis] === value && product.optionAxes.every((a) => a.code === axis || !selected[a.code] || v.options[a.code] === selected[a.code]),
    );
  return { selected, variant, choose, available };
}

/** One chip group per option axis (size, colour…). */
export function OptionAxes({
  product,
  selected,
  available,
  onChoose,
}: {
  product: ProductDetail;
  selected: Record<string, string>;
  available: (axis: string, value: string) => boolean;
  onChoose: (axis: string, value: string) => void;
}) {
  return (
    <>
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
                  onClick={() => onChoose(axis.code, value)}
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
    </>
  );
}
