import type { Money } from "@al-lahiq/api-client";
import { cn } from "@/lib/cn";
import { priceParts, uomShort } from "@/lib/format";

/**
 * The shelf-tag price: condensed numerals, small fils, the unit always shown.
 * Prices are VAT-inclusive (UAE rules for consumer prices).
 */
export function PriceTag({
  price,
  uom,
  was,
  from,
  size = "md",
  className,
}: {
  price: Money;
  uom?: string;
  was?: Money | null;
  from?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const { whole, dec } = priceParts(price.fils);
  const big = { sm: "text-xl", md: "text-[26px]", lg: "text-4xl", xl: "text-5xl" }[size];
  const small = { sm: "text-xs", md: "text-sm", lg: "text-lg", xl: "text-xl" }[size];
  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-2", className)}>
      <span className="sr-only">{`${from ? "From " : ""}${price.formatted}${uom ? ` per ${uomShort(uom)}` : ""}`}</span>
      <span aria-hidden className="tag-price inline-flex items-baseline text-ink">
        {from && <span className={cn("mr-1 font-sans font-medium text-steel", small)}>from</span>}
        <span className={cn("mr-0.5 font-semibold text-steel", small)}>AED</span>
        <span className={big}>{whole}</span>
        <span className={cn("self-start mt-0.5", small)}>.{dec}</span>
        {uom && <span className={cn("ml-1 font-sans font-medium text-steel", small)}>/ {uomShort(uom)}</span>}
      </span>
      {was && was.fils > price.fils && (
        <s className={cn("text-steel-light", small)} aria-label={`was ${was.formatted}`}>
          {was.formatted}
        </s>
      )}
    </div>
  );
}
