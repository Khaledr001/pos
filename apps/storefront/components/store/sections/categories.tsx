import type { HomeData } from "@devsfleet/storefront-client";
import type { HomeSectionSettings } from "@devsfleet/shared-types";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { departmentIcon } from "@/lib/department-icon";
import { busiestFirst, displayName } from "@/lib/format";
import { SectionFrame, SectionHeader } from "./section-header";

const DEFAULT_LIMIT = 11;

export function Categories({ settings, home }: { settings: HomeSectionSettings["categories"]; home: HomeData }) {
  const departments = busiestFirst(home.categories);
  if (departments.length === 0) return null;
  const limit = Math.max(1, Math.min(settings.limit ?? DEFAULT_LIMIT, 24));
  return (
    <SectionFrame>
      <section className="mt-12" aria-labelledby="departments">
        <SectionHeader
          id="departments"
          title={settings.title?.trim() || "Shop by department"}
          href="/departments"
          link="All departments"
        />
        <nav aria-label="Shop by department">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {departments.slice(0, limit).map((d) => {
              const Icon = departmentIcon(d.name);
              return (
                <li key={d.slug}>
                  <Link
                    href={`/category/${d.slug}`}
                    className="group flex h-full items-center gap-3 rounded-[var(--radius-panel)] border border-galv bg-paper p-3 transition-colors hover:border-pipe hover:bg-pipe-tint/40 sm:flex-col sm:items-start sm:p-4"
                  >
                    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-tag)] bg-pipe-tint text-pipe sm:size-11 transition-colors group-hover:bg-pipe group-hover:text-white">
                      <Icon className="size-6" aria-hidden />
                    </span>
                    <span>
                      <span className="block font-cond text-base font-semibold leading-tight sm:text-lg">{displayName(d.name)}</span>
                      <span className="mt-0.5 block text-sm text-steel">
                        {d.productCount} {d.productCount === 1 ? "product" : "products"}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
            {departments.length > limit && (
              <li>
                <Link
                  href="/departments"
                  className="group flex h-full min-h-16 flex-col justify-between gap-1 rounded-[var(--radius-panel)] bg-ink p-3 text-white transition-colors hover:bg-pipe-dark sm:gap-3 sm:p-4"
                >
                  <span className="font-cond text-lg font-semibold leading-tight">All departments</span>
                  <span className="inline-flex items-center gap-1 text-sm text-white/80">
                    {departments.length} departments{" "}
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </Link>
              </li>
            )}
          </ul>
        </nav>
      </section>
    </SectionFrame>
  );
}
