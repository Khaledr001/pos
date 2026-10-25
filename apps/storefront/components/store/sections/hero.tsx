import type { HomeData, StoreInfo } from "@devsfleet/storefront-client";
import type { HomeSectionSettings } from "@devsfleet/shared-types";
import { ArrowRight, BadgePercent, MessageCircle, PackageSearch, Truck } from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { NavAnchor } from "@/components/store/nav-anchor";
import { SearchBox } from "@/components/store/search-box";
import { buttonClass } from "@/components/ui/button";
import { busiestFirst, displayName, whatsappLink } from "@/lib/format";
import { safeHref } from "@/lib/links";

const POPULAR_LINKS = 6;

type Props = { settings: HomeSectionSettings["hero"]; home: HomeData; store: StoreInfo };

/** What the hero says: the shop's own words first, then the lead banner, then the store's name. */
function copy({ settings, home, store }: Props) {
  const lead = home.hero[0];
  const cta = safeHref(settings.ctaHref ?? lead?.linkUrl);
  return {
    lead,
    headline: settings.headline?.trim() || lead?.title || store.name,
    sub: settings.subheadline?.trim() || lead?.subtitle || store.tagline || "",
    cta: cta ? { href: cta, label: settings.ctaLabel?.trim() || lead?.ctaLabel || "Shop now" } : null,
  };
}

/** Real sub-categories from the busiest departments, so every "popular" link leads somewhere stocked. */
function popularLinks(home: HomeData) {
  return busiestFirst(home.categories)
    .flatMap((d) => d.children.slice(0, 1))
    .slice(0, POPULAR_LINKS);
}

function Popular({ home, tone }: { home: HomeData; tone: "dark" | "light" }) {
  const popular = popularLinks(home);
  if (popular.length === 0) return null;
  const chip =
    tone === "dark"
      ? "border-white/25 text-white/90 hover:border-white hover:bg-white/10"
      : "border-ink/20 text-ink hover:border-ink hover:bg-ink/5";
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span className={tone === "dark" ? "text-sm text-white/70" : "text-sm text-steel"}>Popular:</span>
      {popular.map((c) => (
        <Link
          key={c.slug}
          href={`/category/${c.slug}`}
          className={`inline-flex min-h-8 items-center rounded-full border px-3 text-sm transition-colors ${chip}`}
        >
          {displayName(c.name)}
        </Link>
      ))}
    </div>
  );
}

/** The search is the hero: shoppers come looking for a specific item. */
function HeroSearch({ className }: { className?: string }) {
  return (
    <Suspense>
      <div data-hero-search className={className}>
        <SearchBox />
      </div>
    </Suspense>
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
      <ArrowRight className="size-5 shrink-0 text-white/60 transition-transform group-hover:translate-x-0.5 group-hover:text-white" aria-hidden />
    </Link>
  );
}

function ShortcutPanel({ store }: { store: StoreInfo }) {
  return (
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
          href={whatsappLink(store.whatsapp, `Hello ${store.name}, I'd like a quote for this list:`)}
          external
          icon={<MessageCircle className="size-5" aria-hidden />}
          title="Send us your list"
          body="Paste a list on WhatsApp and we'll quote it."
        />
      )}
      <HeroAction
        href="/track"
        icon={<PackageSearch className="size-5" aria-hidden />}
        title="Track an order"
        body="See where your delivery is and download its tax invoice."
      />
    </div>
  );
}

export function Hero(props: Props) {
  const { settings, home, store } = props;
  const { lead, headline, sub, cta } = copy(props);
  const promo = home.strip[0];
  const variant = settings.variant ?? "banner";

  if (variant === "minimal") {
    return (
      <section className="border-b border-galv bg-sheet">
        <div className="mx-auto max-w-3xl px-4 py-12 text-center sm:py-16">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl">{headline}</h1>
          {sub && <p className="mx-auto mt-4 max-w-[52ch] text-lg text-steel">{sub}</p>}
          <HeroSearch className="mx-auto mt-7 max-w-xl text-left" />
          <div className="flex justify-center">
            <Popular home={home} tone="light" />
          </div>
          {cta && (
            <NavAnchor href={cta.href} className={buttonClass("primary", "lg", "mt-6")}>
              {cta.label}
            </NavAnchor>
          )}
        </div>
      </section>
    );
  }

  if (variant === "split") {
    return (
      <section className="border-b border-galv bg-paper">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:py-14 lg:grid-cols-2 lg:items-center">
          <div>
            <h1 className="max-w-[18ch] text-4xl sm:text-5xl lg:text-6xl">{headline}</h1>
            {sub && <p className="mt-4 max-w-[52ch] text-lg text-steel">{sub}</p>}
            <HeroSearch className="mt-7 max-w-xl" />
            <Popular home={home} tone="light" />
            {cta && (
              <NavAnchor href={cta.href} className={buttonClass("primary", "lg", "mt-6")}>
                {cta.label}
              </NavAnchor>
            )}
          </div>
          {lead?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded banner of unknown size
            <img src={lead.imageUrl} alt="" className="aspect-[4/3] w-full rounded-[var(--radius-panel)] object-cover" />
          ) : (
            <div className="blueprint rounded-[var(--radius-panel)] bg-ink p-4 text-white sm:p-6">
              <ShortcutPanel store={store} />
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="blueprint bg-ink text-white">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-10 sm:py-14 lg:grid-cols-[1.4fr_1fr] lg:items-center lg:py-16">
        <div>
          {promo && (
            <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-brass-tint px-3 py-1 text-sm font-semibold text-ink">
              <Truck className="size-4" aria-hidden />
              {promo.title}
            </p>
          )}
          <h1 className="max-w-[18ch] text-4xl sm:text-5xl lg:text-6xl">{headline}</h1>
          {sub && <p className="mt-4 max-w-[52ch] text-lg text-white/80">{sub}</p>}
          <HeroSearch className="mt-7 max-w-xl" />
          <Popular home={home} tone="dark" />
          {cta && (
            <NavAnchor href={cta.href} className={buttonClass("brass", "lg", "mt-6")}>
              {cta.label}
            </NavAnchor>
          )}
        </div>
        <ShortcutPanel store={store} />
      </div>
    </section>
  );
}
