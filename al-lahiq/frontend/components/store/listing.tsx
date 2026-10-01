import type { Crumb, ProductList } from "@al-lahiq/api-client";
import { Check, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { Pagination } from "@/components/ui/pagination";
import { cn } from "@/lib/cn";
import { activeFilterCount, type ListingQuery, toggle, toSearch } from "@/lib/listing";
import { ProductGrid } from "./product-card";
import { SortSelect } from "./sort-select";

export function Breadcrumbs({ items }: { items: { href: string; label: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-steel">
      <ol className="flex flex-wrap items-center gap-1.5">
        <li>
          <Link href="/" className="hover:text-ink">
            Home
          </Link>
        </li>
        {items.map((c, i) => (
          <li key={c.href} className="flex items-center gap-1.5">
            <span aria-hidden>/</span>
            {i === items.length - 1 ? (
              <span aria-current="page" className="text-ink">
                {c.label}
              </span>
            ) : (
              <Link href={c.href} className="hover:text-ink">
                {c.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function crumbsFrom(trail: Crumb[]) {
  return trail.map((c) => ({ href: `/category/${c.slug}`, label: c.name }));
}

function FilterLink({ href, active, children, count }: { href: string; active: boolean; children: ReactNode; count?: number }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className="group flex items-center gap-2 rounded-[var(--radius-tag)] px-1 py-1 text-[15px] hover:bg-sheet"
    >
      <span
        aria-hidden
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center rounded-[3px] border",
          active ? "border-pipe bg-pipe text-white" : "border-steel-light bg-paper",
        )}
      >
        {active && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span className="flex-1">{children}</span>
      {count !== undefined && <span className="text-sm text-steel">{count}</span>}
    </Link>
  );
}

function Filters({ data, query, path }: { data: ProductList; query: ListingQuery; path: string }) {
  const href = (q: ListingQuery) => `${path}${toSearch(q)}`;
  const { facets } = data;
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-lg">Availability</h3>
        <FilterLink href={href({ ...query, inStock: !query.inStock, page: 1 })} active={query.inStock}>
          In stock only
        </FilterLink>
      </section>

      {facets.brands.length > 1 && (
        <section>
          <h3 className="mb-2 text-lg">Brand</h3>
          {facets.brands.map((b) => (
            <FilterLink key={b.slug} href={href(toggle(query, "brand", b.slug))} active={query.brand.includes(b.slug)} count={b.count}>
              {b.name}
            </FilterLink>
          ))}
        </section>
      )}

      {facets.attributes.map((a) => (
        <section key={a.code}>
          <h3 className="mb-2 text-lg">{a.name}</h3>
          {a.values.slice(0, 12).map((v) => (
            <FilterLink
              key={v.value}
              href={href(toggle(query, { attr: a.code }, v.value))}
              active={(query.attr[a.code] ?? []).includes(v.value)}
              count={v.count}
            >
              {v.value}
              {a.unit ? ` ${a.unit}` : ""}
            </FilterLink>
          ))}
        </section>
      ))}

      <section>
        <h3 className="mb-2 text-lg">Price (AED, incl. VAT)</h3>
        <form action={path} className="flex items-end gap-2">
          {query.q && <input type="hidden" name="q" value={query.q} />}
          {query.brand.length > 0 && <input type="hidden" name="brand" value={query.brand.join(",")} />}
          {Object.entries(query.attr).map(([k, v]) => v.length > 0 && <input key={k} type="hidden" name={`attr[${k}]`} value={v.join(",")} />)}
          {query.inStock && <input type="hidden" name="inStock" value="1" />}
          {query.sort && <input type="hidden" name="sort" value={query.sort} />}
          <label className="flex-1 text-sm">
            <span className="text-steel">Min</span>
            <input
              name="minPrice"
              inputMode="decimal"
              defaultValue={query.minPrice}
              placeholder={facets.price?.min != null ? String(Math.floor(facets.price.min)) : ""}
              className="mt-1 h-9 w-full rounded-[var(--radius-tag)] border border-galv bg-paper px-2"
            />
          </label>
          <label className="flex-1 text-sm">
            <span className="text-steel">Max</span>
            <input
              name="maxPrice"
              inputMode="decimal"
              defaultValue={query.maxPrice}
              placeholder={facets.price?.max != null ? String(Math.ceil(facets.price.max)) : ""}
              className="mt-1 h-9 w-full rounded-[var(--radius-tag)] border border-galv bg-paper px-2"
            />
          </label>
          <button type="submit" className="h-9 rounded-[var(--radius-tag)] bg-ink px-3 text-sm font-semibold text-white">
            Apply
          </button>
        </form>
      </section>
    </div>
  );
}

/** Shared by category, brand and search pages. */
export function Listing({
  title,
  intro,
  crumbs,
  subcategories,
  data,
  query,
  path,
}: {
  title: string;
  intro?: ReactNode;
  crumbs: { href: string; label: string }[];
  subcategories?: { slug: string; name: string }[];
  data: ProductList;
  query: ListingQuery;
  path: string;
}) {
  const filters = activeFilterCount(query);
  const clearHref = `${path}${toSearch({ q: query.q, brand: [], attr: {}, inStock: false, page: 1 })}`;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <Breadcrumbs items={crumbs} />
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl">{title}</h1>
          {intro && <div className="mt-1 max-w-[70ch] text-steel">{intro}</div>}
        </div>
      </div>

      {subcategories && subcategories.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {subcategories.map((s) => (
            <li key={s.slug}>
              <Link href={`/category/${s.slug}`} className="inline-flex h-9 items-center rounded-full border border-galv bg-paper px-4 text-[15px] hover:border-ink">
                {s.name}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside aria-label="Filters">
          <details className="group rounded-[var(--radius-panel)] border border-galv bg-paper lg:border-0 lg:bg-transparent" open>
            <summary className="flex cursor-pointer list-none items-center gap-2 p-3 font-semibold lg:hidden">
              <SlidersHorizontal className="size-4" /> Filters{filters ? ` (${filters})` : ""}
            </summary>
            <div className="p-3 pt-0 lg:p-0">
              <Filters data={data} query={query} path={path} />
            </div>
          </details>
        </aside>

        <section aria-label="Products">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-steel">
              <span className="font-cond text-xl font-semibold text-ink">{data.total}</span> {data.total === 1 ? "product" : "products"}
              {filters > 0 && (
                <Link href={clearHref} className="ml-3 text-pipe hover:underline">
                  Clear filters
                </Link>
              )}
            </p>
            <Suspense>
              <SortSelect hasQuery={!!query.q} />
            </Suspense>
          </div>

          {data.items.length ? (
            <>
              <ProductGrid products={data.items} priorityCount={4} />
              <div className="mt-8 flex justify-center">
                <Pagination
                  page={data.page}
                  pageSize={data.pageSize}
                  total={data.total}
                  href={(p) => `${path}${toSearch({ ...query, page: p })}`}
                />
              </div>
            </>
          ) : (
            <EmptyState
              title={query.q ? `No products match “${query.q}”` : "No products match these filters"}
              action={
                filters > 0 ? (
                  <ButtonLink href={clearHref} variant="secondary">
                    Clear filters
                  </ButtonLink>
                ) : (
                  <ButtonLink href="/contact" variant="secondary">
                    Ask us to source it
                  </ButtonLink>
                )
              }
            >
              Check the spelling, try the brand or SKU, or send us the part on WhatsApp and we will find it for you.
            </EmptyState>
          )}
        </section>
      </div>
    </div>
  );
}
