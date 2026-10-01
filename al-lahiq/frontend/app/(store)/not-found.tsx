import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SearchBox } from "@/components/store/search-box";
import { getCategories } from "@/lib/data";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

export default async function NotFound() {
  const categories = await getCategories();
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <p className="font-cond text-lg font-semibold text-steel">Error 404</p>
      <h1 className="text-4xl">We can&apos;t find that page</h1>
      <p className="mt-2 text-steel">
        The link may be old or mistyped. Search for the product by name, brand or SKU, or start from a department.
      </p>
      <Suspense fallback={<div className="mt-6 h-12" />}>
        <SearchBox className="mt-6" />
      </Suspense>

      {categories.length > 0 && (
        <nav aria-labelledby="departments" className="mt-8">
          <h2 id="departments" className="text-2xl">
            Departments
          </h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {categories.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/category/${c.slug}`}
                  className="flex h-12 items-center rounded-[var(--radius-tag)] border border-galv bg-paper px-4 font-cond text-lg font-semibold hover:border-ink"
                >
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <p className="mt-8 text-[15px] text-steel">
        Still stuck?{" "}
        <Link href="/contact" className="font-semibold text-pipe hover:underline">
          Contact us
        </Link>{" "}
        and we&apos;ll help you find it, or go to the{" "}
        <Link href="/" className="font-semibold text-pipe hover:underline">
          home page
        </Link>
        .
      </p>
    </div>
  );
}
