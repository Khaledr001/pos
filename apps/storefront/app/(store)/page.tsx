import type { HomeData, ProductCard } from "@devsfleet/storefront-client";
import {
  ArrowRight,
  BadgePercent,
  Banknote,
  FileText,
  MessageCircle,
  PackageSearch,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { JsonLd } from "@/components/store/json-ld";
import { ProductGrid } from "@/components/store/product-card";
import { RecentlyViewed } from "@/components/store/recently-viewed";
import { HomeSkeleton } from "@/components/store/skeletons";
import { SearchBox } from "@/components/store/search-box";
import { ButtonLink } from "@/components/ui/button";
import { cached, publicApi, tags } from "@/lib/api-server";
import { getStore } from "@/lib/data";
import { departmentIcon } from "@/lib/department-icon";
import { busiestFirst, displayName, whatsappLink } from "@/lib/format";
import { absoluteUrl } from "@/lib/seo";
import { siteOrigin } from "@/lib/site";

/** Department tiles before "All departments"; with that tile the grid fills 2, 3, 4 and 6 columns evenly. */
const HOME_DEPARTMENTS = 11;
const POPULAR_LINKS = 6;

/**
 * A product row is cut to whole rows of four, so a grid never ends on a
 * single orphaned card; fewer than four are shown as they are.
 */
function wholeRows(products: ProductCard[]): ProductCard[] {
  return products.length < 4
    ? products
    : products.slice(0, products.length - (products.length % 4));
}

/** The page's own fetches stream behind this boundary, so the skeleton shows only for the home route. */
export default function HomePage() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <HomeContent />
    </Suspense>
  );
}

async function HomeContent() {
  const [home, store, site] = await Promise.all([
    publicApi.get<HomeData>("/content/home", cached([tags.home, tags.catalog], 600)),
    getStore(),
    siteOrigin(),
  ]);
  const lead = home.hero[0];
  const promo = home.strip[0];
  const departments = busiestFirst(home.categories);
  // Real sub-categories from the busiest departments, so every "popular" link leads somewhere stocked.
  const popular = departments
    .flatMap((d) => d.children.slice(0, 1))
    .slice(0, POPULAR_LINKS);
  const bestSellers = wholeRows(home.bestSellers);
  const newArrivals = wholeRows(home.newArrivals);

  return (
    <>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "Organization",
            name: store.name,
            legalName: store.legalName || undefined,
            url: site,
            logo: store.logoUrl ? absoluteUrl(site, store.logoUrl) : undefined,
            email: store.email || undefined,
            telephone: store.phone || undefined,
          },
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: store.name,
            url: site,
            potentialAction: {
              "@type": "SearchAction",
              target: { "@type": "EntryPoint", urlTemplate: `${site}/search?q={search_term_string}` },
              "query-input": "required name=search_term_string",
            },
          },
        ]}
      />
      {/* The search is the hero: trade buyers come looking for a specific part. */}
      <section className="blueprint bg-ink text-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-10 sm:py-14 lg:grid-cols-[1.4fr_1fr] lg:items-center lg:py-16">
          <div>
            {promo && (
              <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-brass-tint px-3 py-1 text-sm font-semibold text-ink">
                <Truck className="size-4" aria-hidden />
                {promo.title}
              </p>
            )}
            <h1 className="max-w-[18ch] text-4xl sm:text-5xl lg:text-6xl">
              {lead?.title ?? "Everything to build, fix and finish"}
            </h1>
            <p className="mt-4 max-w-[52ch] text-lg text-white/80">
              {lead?.subtitle ??
                "Plumbing, electrical, sanitary ware and tools from brands you trust — delivered across the UAE or ready for pickup."}
            </p>
            <Suspense>
              <div data-hero-search className="mt-7 max-w-xl">
                <SearchBox />
              </div>
            </Suspense>
            {popular.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-sm text-white/70">Popular:</span>
                {popular.map((c) => (
                  <Link
                    key={c.slug}
                    href={`/category/${c.slug}`}
                    className="inline-flex min-h-8 items-center rounded-full border border-white/25 px-3 text-sm text-white/90 transition-colors hover:border-white hover:bg-white/10"
                  >
                    {displayName(c.name)}
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-2 sm:gap-3">
            <HeroAction
              href="/trade"
              icon={<BadgePercent className="size-5" aria-hidden />}
              title="Trade account"
              body="Contractors and resellers get their own price list."
              accent
            />
            {store.whatsapp && (
              <HeroAction
                href={whatsappLink(
                  store.whatsapp,
                  `Hello ${store.name}, I'd like a quote for this list:`,
                )}
                external
                icon={<MessageCircle className="size-5" aria-hidden />}
                title="Send us your list"
                body="Paste a materials list on WhatsApp and we'll quote it."
              />
            )}
            <HeroAction
              href="/track"
              icon={<PackageSearch className="size-5" aria-hidden />}
              title="Track an order"
              body="See where your delivery is and download its tax invoice."
            />
          </div>
        </div>
      </section>

      <section aria-label="Why buy here" className="border-b border-galv bg-paper">
        <ul className="mx-auto grid max-w-7xl grid-cols-2 gap-x-6 gap-y-4 px-4 py-5 lg:grid-cols-4">
          <ServicePoint
            icon={<Truck className="size-5" aria-hidden />}
            title="UAE-wide delivery"
            body="Or collect from a branch"
            href="/branches"
          />
          <ServicePoint
            icon={<FileText className="size-5" aria-hidden />}
            title="VAT tax invoice"
            body="With every order"
          />
          <ServicePoint
            icon={<BadgePercent className="size-5" aria-hidden />}
            title="Trade pricing"
            body="For contractors"
            href="/trade"
          />
          {store.cod.enabled ? (
            <ServicePoint
              icon={<Banknote className="size-5" aria-hidden />}
              title="Cash on delivery"
              body={`On orders up to ${store.currency} ${store.cod.max}`}
            />
          ) : (
            <ServicePoint
              icon={<Banknote className="size-5" aria-hidden />}
              title="Secure card payment"
              body="Pay online at checkout"
            />
          )}
        </ul>
      </section>

      <div className="mx-auto max-w-7xl px-4">
        <section className="mt-12" aria-labelledby="departments">
          <SectionHeader
            id="departments"
            eyebrow="Shop by department"
            title="What are you working on?"
            href="/departments"
            link="All departments"
          />
          <nav aria-label="Shop by department">
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {departments.slice(0, HOME_DEPARTMENTS).map((d) => {
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
                        <span className="block font-cond text-base font-semibold leading-tight sm:text-lg">
                          {displayName(d.name)}
                        </span>
                        <span className="mt-0.5 block text-sm text-steel">
                          {d.productCount} {d.productCount === 1 ? "product" : "products"}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
              {departments.length > HOME_DEPARTMENTS && (
                <li>
                  <Link
                    href="/departments"
                    className="group flex h-full min-h-16 flex-col justify-between gap-1 rounded-[var(--radius-panel)] bg-ink p-3 text-white transition-colors hover:bg-pipe-dark sm:gap-3 sm:p-4"
                  >
                    <span className="font-cond text-lg font-semibold leading-tight">
                      All departments
                    </span>
                    <span className="inline-flex items-center gap-1 text-sm text-white/80">
                      {departments.length} departments{" "}
                      <ArrowRight
                        className="size-4 transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </span>
                  </Link>
                </li>
              )}
            </ul>
          </nav>
        </section>

        {bestSellers.length > 0 && (
          <section className="mt-14" aria-labelledby="best-sellers">
            <SectionHeader
              id="best-sellers"
              eyebrow="Best sellers"
              title="Most ordered this season"
              href="/search?q="
              link="Browse all products"
            />
            <ProductGrid
              products={bestSellers}
              priorityCount={4}
              className="lg:grid-cols-4"
            />
          </section>
        )}

        {home.hero[1] && (
          <section className="blueprint mt-14 grid gap-6 rounded-[var(--radius-panel)] bg-ink p-6 text-white sm:p-10 lg:grid-cols-[auto_1fr_auto] lg:items-center lg:gap-8">
            <span className="hidden size-14 items-center justify-center rounded-[var(--radius-panel)] bg-brass text-ink lg:inline-flex">
              <BadgePercent className="size-7" aria-hidden />
            </span>
            <div>
              <h2 className="text-3xl sm:text-4xl">{home.hero[1].title}</h2>
              {home.hero[1].subtitle && (
                <p className="mt-2 max-w-[60ch] text-lg text-white/80">
                  {home.hero[1].subtitle}
                </p>
              )}
            </div>
            {home.hero[1].linkUrl && (
              <ButtonLink
                href={home.hero[1].linkUrl}
                variant="brass"
                size="lg"
                className="justify-self-start"
              >
                {home.hero[1].ctaLabel ?? "Find out more"}
              </ButtonLink>
            )}
          </section>
        )}

        {home.featuredBrands.length > 0 && (
          <section className="mt-14" aria-labelledby="brands">
            <SectionHeader
              id="brands"
              eyebrow="Genuine stock"
              title="Brands we carry"
              href="/brands"
              link="All brands"
            />
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {home.featuredBrands.map((b) => (
                <li key={b.slug}>
                  <Link
                    href={`/brand/${b.slug}`}
                    className="flex h-20 items-center justify-center rounded-[var(--radius-panel)] border border-galv bg-paper px-4 text-center font-cond text-xl font-semibold transition-colors hover:border-ink"
                  >
                    {b.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded logos of unknown size
                      <img
                        src={b.logoUrl}
                        alt={displayName(b.name)}
                        className="max-h-10 max-w-full object-contain"
                        loading="lazy"
                      />
                    ) : (
                      displayName(b.name)
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {newArrivals.length > 0 && (
          <section className="mt-14" aria-labelledby="new">
            <SectionHeader
              id="new"
              eyebrow="Just arrived"
              title="New in stock"
              href="/search?q=&sort=newest"
              link="See everything new"
            />
            <ProductGrid products={newArrivals} className="lg:grid-cols-4" />
          </section>
        )}

        <RecentlyViewed className="mt-14" />
      </div>
    </>
  );
}

function SectionHeader({
  id,
  eyebrow,
  title,
  href,
  link,
}: {
  id: string;
  eyebrow: string;
  title: string;
  href: string;
  link: string;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wider text-pipe">
          {eyebrow}
        </p>
        <h2 id={id} className="mt-1 text-3xl">
          {title}
        </h2>
      </div>
      <Link
        href={href}
        className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-pipe hover:underline"
      >
        {link} <ArrowRight className="size-4" aria-hidden />
      </Link>
    </div>
  );
}

function HeroAction({
  href,
  icon,
  title,
  body,
  accent,
  external,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  body: string;
  accent?: boolean;
  external?: boolean;
}) {
  return (
    <Link
      href={href}
      {...(external ? { target: "_blank", rel: "noopener" } : {})}
      className="group flex items-center gap-3 rounded-[var(--radius-panel)] border border-white/15 bg-white/[0.06] p-3 transition-colors sm:gap-4 sm:p-4 hover:border-white/40 hover:bg-white/10"
    >
      <span
        className={
          accent
            ? "inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-tag)] bg-brass text-ink"
            : "inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-tag)] bg-white/10 text-white"
        }
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="hidden text-sm text-white/75 sm:block">{body}</span>
      </span>
      <ArrowRight
        className="size-5 shrink-0 text-white/60 transition-transform group-hover:translate-x-0.5 group-hover:text-white"
        aria-hidden
      />
    </Link>
  );
}

function ServicePoint({
  icon,
  title,
  body,
  href,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  href?: string;
}) {
  const content = (
    <>
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-pipe-tint text-pipe">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-semibold leading-tight">{title}</span>
        <span className="block text-sm text-steel">{body}</span>
      </span>
    </>
  );
  return (
    <li>
      {href ? (
        <Link
          href={href}
          className="flex items-center gap-3 rounded-[var(--radius-tag)] hover:text-pipe"
        >
          {content}
        </Link>
      ) : (
        <div className="flex items-center gap-3">{content}</div>
      )}
    </li>
  );
}
