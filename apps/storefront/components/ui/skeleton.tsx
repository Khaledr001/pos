import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** A placeholder block; the sweep animation is switched off under reduced motion in globals.css. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton rounded-[var(--radius-tag)]", className)} />;
}

/** Wraps a route's placeholder so assistive tech hears one "Loading" instead of a page of empty boxes. */
export function LoadingRegion({ label = "Loading…", className, children }: { label?: string; className?: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function SkeletonLines({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-4", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

/** Same box model as ProductCard, so the grid does not shift when the real cards arrive. */
export function ProductCardSkeleton() {
  return (
    <div className="flex w-full flex-col overflow-hidden rounded-[var(--radius-panel)] border border-galv bg-paper">
      <Skeleton className="aspect-square rounded-none" />
      <div className="flex flex-1 flex-col gap-2 border-t border-galv p-3">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="mt-3 h-7 w-1/2" />
      </div>
    </div>
  );
}

export function ProductGridSkeleton({ count = 8, className }: { count?: number; className?: string }) {
  return (
    <ul className={cn("grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4", className)}>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex">
          <ProductCardSkeleton />
        </li>
      ))}
    </ul>
  );
}
