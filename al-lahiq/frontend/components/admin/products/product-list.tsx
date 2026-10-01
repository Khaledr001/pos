"use client";

import type { AdminCategory, AdminProductList } from "@al-lahiq/api-client";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { Pagination } from "@/components/ui/pagination";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { useAdminQuery } from "../data";
import { FilterSelect, SearchInput, useListParams } from "../list-controls";
import { DataTable, ErrorState, FilterTabs, Loading, num, PageHeader, Panel, Thumb } from "../ui";

export const MISSING_LABEL: Record<string, string> = {
  description: "No description",
  images: "No photos",
  category: "No category",
  price: "No price from POS",
};

const PAGE_SIZE = 25;

export function ProductList() {
  const params = useListParams();
  const q = params.get("q");
  const status = params.get("status");
  const categoryId = params.get("categoryId");
  const { data, error, isPending, refetch, isFetching } = useAdminQuery<AdminProductList>("/admin/products", {
    q,
    status,
    categoryId,
    page: params.page,
    pageSize: PAGE_SIZE,
  });
  const categories = useAdminQuery<AdminCategory[]>("/admin/categories");
  const filtered = !!(q || categoryId);

  return (
    <>
      <PageHeader
        title="Products"
        description="Products, SKUs, prices and stock come from the POS. Here you add what shoppers see: photos, descriptions, specs and the category, then publish."
      />
      <Panel flush>
        <div className="px-3 pt-1">
          <FilterTabs
            label="Product status"
            value={status}
            onChange={(v) => params.set({ status: v })}
            items={[
              { value: "", label: "All products" },
              { value: "published", label: "Published" },
              { value: "draft", label: "Drafts" },
            ]}
          />
        </div>
        <div className="flex flex-col gap-3 border-b border-galv p-3 sm:flex-row sm:items-center">
          <SearchInput
            className="flex-1"
            label="Search products"
            placeholder="Product name or SKU"
            value={q}
            onSearch={(v) => params.set({ q: v })}
          />
          <FilterSelect
            label="Category"
            value={categoryId}
            onChange={(v) => params.set({ categoryId: v })}
            options={[
              { value: "", label: "All categories" },
              ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>

        {error ? (
          <div className="p-3">
            <ErrorState error={error} onRetry={() => refetch()} />
          </div>
        ) : isPending ? (
          <Loading label="Loading products" />
        ) : !data.items.length ? (
          <div className="p-3">
            <EmptyState title={filtered ? "No products match your search" : "No products here yet"}>
              {filtered
                ? "Check the spelling, or search by SKU."
                : "New products appear here automatically when they are added in the POS."}
            </EmptyState>
          </div>
        ) : (
          <div className={cn(isFetching && "opacity-70")}>
            <DataTable minWidth={960}>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Brand and category</th>
                  <th scope="col">SKUs</th>
                  <th scope="col" className="!text-right">
                    From price
                  </th>
                  <th scope="col">Stock</th>
                  <th scope="col">Shop</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="flex items-start gap-3">
                        <Thumb url={p.imageUrl} alt="" size={44} />
                        <div className="min-w-0">
                          <Link href={`/admin/products/${p.id}`} className="font-medium text-ink hover:text-pipe hover:underline">
                            {p.name}
                          </Link>
                          {p.missing.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {p.missing.map((m) => (
                                <Badge key={m} tone={m === "price" ? "signal" : "brass"}>
                                  {MISSING_LABEL[m] ?? m}
                                </Badge>
                              ))}
                            </div>
                          )}
                          <p className="mt-0.5 text-[12px] text-steel">Updated {formatDate(p.updatedAt)}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <p>{p.brand ?? <span className="text-steel">No brand</span>}</p>
                      <p className="text-[13px] text-steel">{p.category ?? "No category"}</p>
                    </td>
                    <td>
                      <p className="font-mono text-[13px]">{p.skus.slice(0, 2).join(", ")}</p>
                      {p.skus.length > 2 && <p className="text-[12px] text-steel">and {p.skus.length - 2} more</p>}
                      {p.activeVariants < p.skus.length && (
                        <p className="text-[12px] text-steel">{p.skus.length - p.activeVariants} inactive in POS</p>
                      )}
                    </td>
                    <td className={num}>{p.fromPrice?.formatted ?? <span className="font-sans font-normal text-steel">None</span>}</td>
                    <td>
                      <Badge tone={p.inStock ? "pipe" : "signal"}>{p.inStock ? "In stock" : "Out of stock"}</Badge>
                    </td>
                    <td>
                      <Badge tone={p.published ? "pipe" : "neutral"}>{p.published ? "Published" : "Draft"}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </div>
        )}
        {data && data.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-galv px-3 py-2">
            <p className="text-sm text-steel">{data.total.toLocaleString("en-AE")} products</p>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} href={params.pageHref} />
          </div>
        )}
      </Panel>
    </>
  );
}
