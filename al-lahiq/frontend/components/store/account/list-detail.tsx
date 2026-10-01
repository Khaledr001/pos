"use client";

import type { ProjectListDetail, ProjectListSummary } from "@al-lahiq/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { FormError, inputClass } from "@/components/ui/field";
import { ProductImage } from "@/components/ui/product-image";
import { QtyInput } from "@/components/ui/qty-input";
import { api, ApiError } from "@/lib/api-browser";
import { aed, uomShort } from "@/lib/format";
import { AddToCartAction } from "./add-to-cart-result";
import { QueryError, friendlyError } from "./session";

type Item = ProjectListDetail["items"][number];

function CopyToList({ item, lists }: { item: Item; lists: ProjectListSummary[] }) {
  const qc = useQueryClient();
  const [target, setTarget] = useState("");
  const copy = useMutation({
    mutationFn: (listId: string) => api.post<ProjectListDetail>(`/me/lists/${listId}/items`, { variantId: item.variantId, uom: item.uom, quantity: item.quantity }),
    onSuccess: (detail) => {
      qc.setQueryData(["list", detail.id], detail);
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
  });
  const targetName = lists.find((l) => l.id === copy.variables)?.name;
  return (
    <div className="mt-2">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (target) copy.mutate(target);
        }}
      >
        <label className="sr-only" htmlFor={`copy-${item.id}`}>
          Add {item.productName} to another list
        </label>
        <select id={`copy-${item.id}`} value={target} onChange={(e) => setTarget(e.target.value)} className={`${inputClass} h-8 w-auto max-w-56 py-0 text-sm`}>
          <option value="">Add to another list…</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" variant="secondary" disabled={!target} loading={copy.isPending}>
          Add
        </Button>
      </form>
      <p aria-live="polite" className="text-sm empty:hidden">
        {copy.isSuccess && targetName && <span className="text-pipe-dark">Added to {targetName}.</span>}
        {copy.error && <span className="text-signal">{friendlyError(copy.error)}</span>}
      </p>
    </div>
  );
}

function ItemRow({ listId, item, otherLists }: { listId: string; item: Item; otherLists: ProjectListSummary[] }) {
  const qc = useQueryClient();
  const onSuccess = (detail: ProjectListDetail) => {
    qc.setQueryData(["list", listId], detail);
    qc.invalidateQueries({ queryKey: ["lists"] });
  };
  const setQty = useMutation({
    mutationFn: (quantity: number) => api.post<ProjectListDetail>(`/me/lists/${listId}/items`, { variantId: item.variantId, uom: item.uom, quantity }),
    onSuccess,
  });
  const remove = useMutation({
    mutationFn: () => api.delete<ProjectListDetail>(`/me/lists/${listId}/items/${item.id}`),
    onSuccess,
  });
  const error = setQty.error ?? remove.error;

  return (
    <li className="grid grid-cols-[64px_1fr] gap-3 py-4 sm:grid-cols-[80px_1fr_auto] sm:gap-4">
      <Link href={`/product/${item.productSlug}`} tabIndex={-1} aria-hidden className="block self-start overflow-hidden rounded-[var(--radius-tag)] border border-galv">
        <ProductImage image={item.imageUrl ? { url: item.imageUrl, alt: item.productName } : null} name={item.productName} brand="" sizes="80px" />
      </Link>
      <div className="min-w-0">
        <Link href={`/product/${item.productSlug}`} className="font-medium hover:underline">
          {item.productName}
        </Link>
        {item.variantName && item.variantName !== item.productName && <p className="text-sm text-steel">{item.variantName}</p>}
        <p className="text-sm text-steel">SKU {item.sku}</p>
        <div className="mt-1">
          {item.available ? <Badge tone="pipe">Available</Badge> : <Badge tone="signal">No longer available</Badge>}
        </div>
        {otherLists.length > 0 && <CopyToList item={item} lists={otherLists} />}
        {error && (
          <div className="mt-2">
            <FormError message={friendlyError(error)} />
          </div>
        )}
      </div>
      <div className="col-span-2 flex flex-wrap items-center justify-between gap-4 sm:col-span-1 sm:flex-col sm:items-end sm:justify-start">
        <QtyInput value={item.quantity} onChange={(q) => setQty.mutate(q)} uom={item.uom} size="sm" disabled={setQty.isPending || !item.available} label={`Quantity of ${item.productName}`} />
        <div className="text-right">
          {item.lineTotal ? <p className="tag-price text-2xl">{item.lineTotal.formatted}</p> : <p className="text-sm text-steel">No price</p>}
          {item.unitPrice && (
            <p className="text-sm text-steel">
              {item.unitPrice.formatted} / {uomShort(item.uom)}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
          className="inline-flex items-center gap-1 text-sm text-steel hover:text-signal disabled:opacity-50"
        >
          <Trash2 className="size-4" aria-hidden /> Remove<span className="sr-only"> {item.productName}</span>
        </button>
      </div>
    </li>
  );
}

export function ListDetail({ id }: { id: string }) {
  const { data: list, isLoading, error } = useQuery({
    queryKey: ["list", id],
    queryFn: () => api.get<ProjectListDetail>(`/me/lists/${id}`),
  });
  const { data: lists } = useQuery({
    queryKey: ["lists"],
    queryFn: () => api.get<ProjectListSummary[]>("/me/lists"),
  });

  const back = (
    <Link href="/account/lists" className="mb-3 inline-flex items-center gap-1 text-sm text-steel hover:text-ink">
      <ChevronLeft className="size-4" aria-hidden /> All lists
    </Link>
  );

  if (isLoading) return <p className="text-steel">Loading your list…</p>;
  if (error || !list) {
    const missing = error instanceof ApiError && (error.status === 404 || error.status === 400);
    return (
      <div>
        {back}
        <EmptyState title={missing ? "We can't find this list" : "This list didn't load"} action={<ButtonLink href="/account/lists" variant="secondary">See your lists</ButtonLink>}>
          {missing ? "It may have been deleted." : <QueryError error={error} />}
        </EmptyState>
      </div>
    );
  }

  const otherLists = (lists ?? []).filter((l) => l.id !== list.id);
  const available = list.items.filter((i) => i.available);
  const total = available.reduce((sum, i) => sum + (i.lineTotal?.fils ?? 0), 0);
  const names = Object.fromEntries(list.items.map((i) => [i.sku, i.productName]));

  return (
    <div>
      {back}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl">{list.name}</h1>
          <p className="mt-1 text-steel">
            {list.items.length === 1 ? "1 item" : `${list.items.length} items`}
            {total > 0 && (
              <>
                , <span className="tag-price text-lg text-ink">{aed(total)}</span> incl. VAT at today&apos;s prices
              </>
            )}
          </p>
        </div>
        {list.items.length > 0 && (
          <AddToCartAction path={`/me/lists/${list.id}/to-cart`} label="Add all to cart" names={names} disabled={available.length === 0} className="sm:max-w-sm" />
        )}
      </div>

      {list.items.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="This list is empty" action={<ButtonLink href="/">Find products</ButtonLink>}>
            {list.isWishlist
              ? "Tap the heart button on any product page to save it here."
              : "Save products to your wishlist with the heart button, then add them to this list from your wishlist."}
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-galv rounded-[var(--radius-panel)] border border-galv bg-paper px-4">
          {list.items.map((item) => (
            <ItemRow key={item.id} listId={list.id} item={item} otherLists={otherLists} />
          ))}
        </ul>
      )}
    </div>
  );
}
