import { LoadingRegion, Skeleton, SkeletonLines, ProductGridSkeleton } from "@/components/ui/skeleton";

function BreadcrumbSkeleton() {
  return <Skeleton className="h-5 w-56" />;
}

/** Mirrors Listing: heading, filters sidebar on desktop, toolbar and product grid. */
export function ListingSkeleton() {
  return (
    <LoadingRegion className="mx-auto max-w-7xl px-4 py-6">
      <BreadcrumbSkeleton />
      <Skeleton className="mt-4 h-10 w-72 max-w-full" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-6">
          <Skeleton className="h-12 w-full lg:hidden" />
          <div className="hidden space-y-6 lg:block">
            {[4, 5, 3].map((rows, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-6 w-24" />
                {Array.from({ length: rows }, (_, r) => (
                  <Skeleton key={r} className="h-6 w-full" />
                ))}
              </div>
            ))}
          </div>
        </aside>
        <section>
          <div className="mb-4 flex items-center justify-between gap-3">
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-10 w-40" />
          </div>
          <ProductGridSkeleton count={12} />
        </section>
      </div>
    </LoadingRegion>
  );
}

/** Mirrors the product page: gallery left, name and buy box right, details below. */
export function ProductPageSkeleton() {
  return (
    <LoadingRegion className="mx-auto max-w-7xl px-4 py-6">
      <BreadcrumbSkeleton />
      <div className="mt-4 grid gap-8 lg:grid-cols-2">
        <div>
          <Skeleton className="aspect-square rounded-[var(--radius-panel)]" />
          <div className="mt-3 flex gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="size-20" />
            ))}
          </div>
        </div>
        <div>
          <Skeleton className="h-5 w-24" />
          <Skeleton className="mt-2 h-10 w-4/5" />
          <div className="mt-5 space-y-4 rounded-[var(--radius-panel)] border border-galv bg-paper p-5">
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      </div>
      <div className="mt-12 grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <Skeleton className="mb-3 h-8 w-56" />
          <SkeletonLines lines={5} />
        </div>
        <div>
          <Skeleton className="mb-3 h-8 w-44" />
          <div className="space-y-3">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        </div>
      </div>
    </LoadingRegion>
  );
}

export function HomeSkeleton() {
  return (
    <LoadingRegion>
      <div className="bg-ink">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-10 sm:py-14 lg:grid-cols-[1.4fr_1fr] lg:items-center lg:py-16">
          <div className="space-y-4">
            <Skeleton className="h-14 w-4/5 bg-white/10 sm:h-16" />
            <Skeleton className="h-6 w-3/5 bg-white/10" />
            <Skeleton className="mt-3 h-12 w-full max-w-xl bg-white/10" />
          </div>
          <div className="grid gap-2 sm:gap-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-[68px] bg-white/10" />
            ))}
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-4">
        <Skeleton className="mt-12 mb-5 h-9 w-72" />
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {Array.from({ length: 12 }, (_, i) => (
            <li key={i}>
              <Skeleton className="h-16 w-full sm:h-28" />
            </li>
          ))}
        </ul>
        <Skeleton className="mt-14 mb-5 h-9 w-72" />
        <ProductGridSkeleton count={4} className="lg:grid-cols-4" />
      </div>
    </LoadingRegion>
  );
}

export function CartSkeleton() {
  return (
    <LoadingRegion className="mx-auto max-w-7xl px-4 py-6">
      <Skeleton className="h-10 w-48" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-[var(--radius-panel)]" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-[var(--radius-panel)]" />
      </div>
    </LoadingRegion>
  );
}

/** Account pages share one frame in the real UI; this is a heading plus a few rows. */
export function AccountSkeleton() {
  return (
    <LoadingRegion className="mx-auto max-w-7xl px-4 py-6">
      <Skeleton className="h-10 w-56" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-[var(--radius-panel)]" />
        ))}
      </div>
    </LoadingRegion>
  );
}
