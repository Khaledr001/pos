import type { HomeData, StoreInfo } from "@devsfleet/storefront-client";
import type { HomeSectionSettings } from "@devsfleet/shared-types";
import { ArrowRight, BadgePercent, MessageCircle, PackageSearch, Truck } from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { NavAnchor } from "@/components/store/nav-anchor";
import { SearchBox } from "@/components/store/search-box";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { busiestFirst, displayName, whatsappLink } from "@/lib/format";
import { safeHref, safeImageSrc } from "@/lib/links";

const POPULAR_LINKS = 6;

type Props = { settings: HomeSectionSettings["hero"]; home: HomeData; store: StoreInfo };

/** What the hero says: the shop's own words first, then the lead banner, then the store's name. */
function copy({ settings, home, store }: Props) {
  const lead = home.hero[0];
  const cta = safeHref(settings.ctaHref ?? lead?.linkUrl);
  const secondary = safeHref(settings.secondaryHref);
  const fallbackLabel = store.features.checkout ? "Shop now" : store.features.products ? "Browse products" : "Learn more";
  return {
    lead,
    headline: settings.headline?.trim() || lead?.title || store.name,
    sub: settings.subheadline?.trim() || lead?.subtitle || store.tagline || "",
    cta: cta ? { href: cta, label: settings.ctaLabel?.trim() || lead?.ctaLabel || fallbackLabel } : null,
    secondary: secondary ? { href: secondary, label: settings.secondaryLabel?.trim() || "Learn more" } : null,
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

/** Shortcuts a shop offers beside the hero. Each one only exists when the site has the feature behind it. */
function shortcuts(store: StoreInfo) {
  const { features } = store;
  return {
    trade: features.accounts,
    whatsapp: !!store.whatsapp,
    track: features.tracking,
    any: features.accounts || !!store.whatsapp || features.tracking,
  };
}

function ShortcutPanel({ store }: { store: StoreInfo }) {
  const has = shortcuts(store);
  return (
    <div className="grid gap-2 sm:gap-3">
      {has.trade && (
        <HeroAction
          href="/trade"
          icon={<BadgePercent className="size-5" aria-hidden />}
          title="Trade account"
          body="Contractors and resellers get their own price list."
          accent
        />
      )}
      {has.whatsapp && (
        <HeroAction
          href={whatsappLink(store.whatsapp, `Hello ${store.name}, I'd like a quote for this list:`)}
          external
          icon={<MessageCircle className="size-5" aria-hidden />}
          title="Send us your list"
          body="Paste a list on WhatsApp and we'll quote it."
        />
      )}
      {has.track && (
        <HeroAction
          href="/track"
          icon={<PackageSearch className="size-5" aria-hidden />}
          title="Track an order"
          body="See where your delivery is and download its tax invoice."
        />
      )}
    </div>
  );
}

const HEIGHT = { sm: "min-h-72", md: "min-h-[28rem]", lg: "min-h-[38rem]" } as const;

/** A full-width photo with the words over it; the one hero that needs no catalogue, search or banners. */
function ImageHero({ settings, headline, sub, cta, secondary }: Pick<ReturnType<typeof copy>, "headline" | "sub" | "cta" | "secondary"> & { settings: Props["settings"] }) {
  const image = safeImageSrc(settings.imageUrl);
  const centered = settings.align === "center";
  return (
    <section className={cn("relative isolate flex items-center overflow-hidden bg-ink text-white", HEIGHT[settings.height ?? "md"] ?? HEIGHT.md)}>
      {image && (
        // eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded photo of unknown size
        <img src={image} alt="" fetchPriority="high" className="absolute inset-0 -z-10 size-full object-cover" />
      )}
      {/* A scrim so white text stays legible on a bright photo: even when centred, darker toward the text. */}
      <span
        aria-hidden
        className={cn("absolute inset-0 -z-10", centered ? "bg-ink/60" : "bg-gradient-to-r from-ink/85 via-ink/55 to-ink/10", !image && "hidden")}
      />
      <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:py-24">
        <div className={cn("max-w-2xl", centered && "mx-auto text-center")}>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl">{headline}</h1>
          {sub && <p className="mt-4 text-lg text-white/85 sm:text-xl">{sub}</p>}
          {(cta || secondary) && (
            <div className={cn("mt-7 flex flex-wrap gap-3", centered && "justify-center")}>
              {cta && (
                <NavAnchor href={cta.href} className={buttonClass("brass", "lg")}>
                  {cta.label}
                </NavAnchor>
              )}
              {secondary && (
                <NavAnchor href={secondary.href} className={buttonClass("onDark", "lg")}>
                  {secondary.label}
                </NavAnchor>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function Hero(props: Props) {
  const { settings, home, store } = props;
  const { lead, headline, sub, cta, secondary } = copy(props);
  const promo = home.strip[0];
  const variant = settings.variant ?? "banner";
  const { features } = store;
  const centered = settings.align === "center";
  const has = shortcuts(store);

  /** The "Popular:" links and the search box only make sense where there is a catalogue to search. */
  const searchBlock = (cls: string, tone: "dark" | "light") => (
    <>
      {features.search && <HeroSearch className={cls} />}
      {features.products && <Popular home={home} tone={tone} />}
    </>
  );
  const buttons = (primaryVariant: "primary" | "brass", on: "light" | "dark") =>
    (cta || secondary) && (
      <div className={cn("mt-6 flex flex-wrap gap-3", centered && "justify-center")}>
        {cta && (
          <NavAnchor href={cta.href} className={buttonClass(primaryVariant, "lg")}>
            {cta.label}
          </NavAnchor>
        )}
        {secondary && (
          <NavAnchor href={secondary.href} className={buttonClass(on === "dark" ? "onDark" : "secondary", "lg")}>
            {secondary.label}
          </NavAnchor>
        )}
      </div>
    );

  if (variant === "image") {
    return <ImageHero settings={settings} headline={headline} sub={sub} cta={cta} secondary={secondary} />;
  }

  if (variant === "minimal") {
    const minimalButtons = buttons("primary", "light");
    return (
      <section className="border-b border-galv bg-sheet">
        <div className={cn("mx-auto max-w-3xl px-4 py-12 sm:py-16", centered || features.search ? "text-center" : "")}>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl">{headline}</h1>
          {sub && <p className="mx-auto mt-4 max-w-[52ch] text-lg text-steel">{sub}</p>}
          {features.search && <HeroSearch className="mx-auto mt-7 max-w-xl text-left" />}
          {features.products && (
            <div className="flex justify-center">
              <Popular home={home} tone="light" />
            </div>
          )}
          {minimalButtons && <div className="flex justify-center">{minimalButtons}</div>}
        </div>
      </section>
    );
  }

  if (variant === "split") {
    const photo = safeImageSrc(settings.imageUrl) ?? safeImageSrc(lead?.imageUrl);
    return (
      <section className="border-b border-galv bg-paper">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:py-14 lg:grid-cols-2 lg:items-center">
          <div className={cn(centered && "text-center")}>
            <h1 className={cn("max-w-[18ch] text-4xl sm:text-5xl lg:text-6xl", centered && "mx-auto")}>{headline}</h1>
            {sub && <p className={cn("mt-4 max-w-[52ch] text-lg text-steel", centered && "mx-auto")}>{sub}</p>}
            {searchBlock("mt-7 max-w-xl", "light")}
            {buttons("primary", "light")}
          </div>
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded banner of unknown size
            <img src={photo} alt="" className="aspect-[4/3] w-full rounded-[var(--radius-panel)] object-cover" />
          ) : has.any ? (
            <div className="blueprint rounded-[var(--radius-panel)] bg-ink p-4 text-white sm:p-6">
              <ShortcutPanel store={store} />
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="blueprint bg-ink text-white">
      <div className={cn("mx-auto grid max-w-7xl gap-10 px-4 py-10 sm:py-14 lg:py-16", has.any && "lg:grid-cols-[1.4fr_1fr] lg:items-center")}>
        <div className={cn(centered && "text-center")}>
          {promo && (
            <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-brass-tint px-3 py-1 text-sm font-semibold text-ink">
              <Truck className="size-4" aria-hidden />
              {promo.title}
            </p>
          )}
          <h1 className={cn("max-w-[18ch] text-4xl sm:text-5xl lg:text-6xl", centered && "mx-auto")}>{headline}</h1>
          {sub && <p className={cn("mt-4 max-w-[52ch] text-lg text-white/80", centered && "mx-auto")}>{sub}</p>}
          {searchBlock("mt-7 max-w-xl", "dark")}
          {buttons("brass", "dark")}
        </div>
        {has.any && <ShortcutPanel store={store} />}
      </div>
    </section>
  );
}
