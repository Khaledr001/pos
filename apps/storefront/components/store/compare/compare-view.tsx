"use client";

import type { ProductDetail } from "@devsfleet/storefront-client";
import { useQueries } from "@tanstack/react-query";
import { X } from "lucide-react";
import Link from "next/link";
import { Breadcrumbs } from "@/components/store/listing";
import { StockBadge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { ProductImage } from "@/components/ui/product-image";
import { api, ApiError } from "@/lib/api-browser";
import { cn } from "@/lib/cn";
import { displayName } from "@/lib/format";
import { useCompare } from "@/lib/hooks/compare";
import { bestStock, lowestPrice } from "@/lib/product-summary";

type Column = { slug: string; name: string; state: "loading" | "missing" | "error" | "ready"; product?: ProductDetail };

const cell = "border-b border-galv p-3 align-top";
const rowHead = "sticky left-0 z-10 w-28 min-w-28 border-b border-r border-galv bg-sheet p-3 text-left align-top text-sm font-semibold text-steel sm:w-40 sm:min-w-40";

export function CompareView() {
  const { items, remove, clear } = useCompare();
  const results = useQueries({
    queries: items.map((i) => ({
      queryKey: ["compare", i.slug],
      queryFn: () => api.get<ProductDetail>(`/catalog/products/${encodeURIComponent(i.slug)}`),
      retry: false,
    })),
  });

  const columns: Column[] = items.map((item, i) => {
    const r = results[i];
    if (r?.data) return { slug: item.slug, name: item.name, state: "ready", product: r.data };
    if (r?.error) return { slug: item.slug, name: item.name, state: r.error instanceof ApiError && r.error.status === 404 ? "missing" : "error" };
    return { slug: item.slug, name: item.name, state: "loading" };
  });

  // Union of spec labels in first-seen order, so shared specs line up and gaps stay blank.
  const specLabels: string[] = [];
  for (const c of columns) for (const s of c.product?.specs ?? []) if (!specLabels.includes(s.label)) specLabels.push(s.label);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <Breadcrumbs items={[{ href: "/compare", label: "Compare" }]} />
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-4xl">Compare products</h1>
        {items.length > 0 && (
          <Button variant="ghost" onClick={clear} className="min-h-11">
            Clear all
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Nothing to compare yet"
            action={
              <ButtonLink href="/search" variant="secondary">
                Browse products
              </ButtonLink>
            }
          >
            Tick “Compare” on up to four products and they will line up here side by side.
          </EmptyState>
        </div>
      ) : (
        <>
          {items.length === 1 && <p className="mt-2 text-steel">Add at least one more product to see the differences.</p>}
          <div
            role="region"
            aria-label="Product comparison table"
            tabIndex={0}
            className="mt-6 overflow-x-auto rounded-[var(--radius-panel)] border border-galv bg-paper"
          >
            <table className="w-full border-collapse text-[15px]">
              <caption className="sr-only">Side-by-side comparison of {items.length} products</caption>
              <thead>
                <tr>
                  <th scope="col" className={cn(rowHead, "bg-sheet")}>
                    <span className="sr-only">Product</span>
                  </th>
                  {columns.map((c) => (
                    <th key={c.slug} scope="col" className={cn(cell, "min-w-48 text-left font-normal")}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="w-28">
                          <ProductImage
                            image={c.product?.images[0] ?? items.find((i) => i.slug === c.slug)?.image ?? null}
                            name={c.name}
                            brand={c.product?.brand?.name}
                            sizes="112px"
                            className="rounded-[var(--radius-tag)] border border-galv"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => remove(c.slug)}
                          aria-label={`Remove ${c.name} from comparison`}
                          className="inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-tag)] text-steel hover:bg-galv/60 hover:text-ink"
                        >
                          <X className="size-5" aria-hidden />
                        </button>
                      </div>
                      <Link href={`/product/${c.slug}`} className="mt-2 block font-cond text-lg font-semibold leading-tight hover:underline">
                        {c.name}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <Row label="Brand" columns={columns} render={(p) => (p.brand ? displayName(p.brand.name) : "")} />
                <Row label="Price" columns={columns} render={(p) => <span className="font-cond text-xl font-bold">{lowestPrice(p)?.formatted ?? "Price on request"}</span>} />
                <Row label="Availability" columns={columns} render={(p) => { const s = bestStock(p); return s ? <StockBadge label={s} /> : ""; }} />
                {specLabels.map((label) => (
                  <Row key={label} label={label} columns={columns} render={(p) => p.specs.find((s) => s.label === label)?.value ?? ""} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, columns, render }: { label: string; columns: Column[]; render: (p: ProductDetail) => React.ReactNode }) {
  return (
    <tr>
      <th scope="row" className={rowHead}>
        {label}
      </th>
      {columns.map((c) => (
        <td key={c.slug} className={cell}>
          {c.state === "ready" && c.product ? render(c.product) : c.state === "loading" ? <span className="text-steel">Loading…</span> : label === "Brand" ? <span className="text-steel">{c.state === "missing" ? "No longer available" : "Could not load"}</span> : null}
        </td>
      ))}
    </tr>
  );
}
