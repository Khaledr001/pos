"use client";

import type { AddedToCart } from "@al-lahiq/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShoppingCart } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { api } from "@/lib/api-browser";
import { cn } from "@/lib/cn";
import { friendlyError } from "./session";

/** What happened after adding a past order or a list to the cart. `names` maps SKU → product name. */
export function AddedToCartMessage({ result, names }: { result: AddedToCart; names: Record<string, string> }) {
  const label = (sku: string) => (names[sku] ? `${names[sku]} (${sku})` : sku);
  const n = result.added.length;
  return (
    <div className="space-y-2 text-[15px]">
      {n > 0 ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-tag)] bg-pipe-tint px-3 py-2 text-pipe-dark">
          {n === 1 ? "1 item was added to your cart." : `${n} items were added to your cart.`}
          <Link href="/cart" className="font-semibold underline">
            View cart
          </Link>
        </p>
      ) : (
        <p className="rounded-[var(--radius-tag)] bg-signal-tint px-3 py-2 text-signal">Nothing could be added to your cart.</p>
      )}
      {result.skipped.length > 0 && (
        <div className="rounded-[var(--radius-tag)] bg-brass-tint px-3 py-2 text-[#7a5a0c]">
          <p>
            {result.skipped.length === 1 ? "This item is" : "These items are"} no longer available, so we left{" "}
            {result.skipped.length === 1 ? "it" : "them"} out:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {result.skipped.map((sku) => (
              <li key={sku}>{label(sku)}</li>
            ))}
          </ul>
          <p className="mt-1">
            Search for an alternative, or{" "}
            <Link href="/contact" className="underline">
              ask us to source it
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}

/** A button that POSTs to an endpoint returning `AddedToCart`, then refreshes the cart. */
export function AddToCartAction({
  path,
  label,
  names,
  variant = "primary",
  className,
  disabled,
}: {
  path: string;
  label: string;
  names: Record<string, string>;
  variant?: "primary" | "secondary";
  className?: string;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const action = useMutation({
    mutationFn: () => api.post<AddedToCart>(path),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cart"] }),
  });
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div>
        <Button variant={variant} onClick={() => action.mutate()} loading={action.isPending} disabled={disabled}>
          <ShoppingCart className="size-4" aria-hidden /> {label}
        </Button>
      </div>
      <div aria-live="polite" className="empty:hidden">
        {action.data && <AddedToCartMessage result={action.data} names={names} />}
        {action.error && <FormError message={friendlyError(action.error)} />}
      </div>
    </div>
  );
}
