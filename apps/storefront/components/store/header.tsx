import type { NavLink } from "@devsfleet/shared-types";
import { Phone } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { buttonClass } from "@/components/ui/button";
import { getCategories, getStore } from "@/lib/data";
import { whatsappLink } from "@/lib/format";
import { safeHref } from "@/lib/links";
import { AnnouncementBar } from "./announcement-bar";
import { DeptNav, MobileMenu } from "./dept-nav";
import { AccountButton, CartButton } from "./header-actions";
import { Logo } from "./logo";
import { MobileSearch } from "./mobile-search";
import { NavAnchor } from "./nav-anchor";
import { SearchBox } from "./search-box";

/** The shop's own menu links and its one call-to-action button. */
function HeaderLinks({ links, cta, className }: { links: NavLink[]; cta: { label: string; href: string } | null; className?: string }) {
  if (links.length === 0 && !cta) return null;
  return (
    <nav aria-label="Main" className={className}>
      <ul className="flex items-center gap-6">
        {links.map((l) => (
          <li key={`${l.label}-${l.href}`}>
            <NavAnchor href={l.href} className="font-medium hover:text-pipe">
              {l.label}
            </NavAnchor>
          </li>
        ))}
      </ul>
      {cta && (
        <NavAnchor href={cta.href} className={buttonClass("primary", "md")}>
          {cta.label}
        </NavAnchor>
      )}
    </nav>
  );
}

/**
 * The shop's header, in the layout its theme picked:
 *  - classic: contact strip, then logo, search and actions on one row
 *  - centered: logo in the middle, search on its own row beneath
 *  - compact: one slim row, no contact strip
 *  - simple: logo, menu links and one button; no search, account or cart
 * What each one shows follows the site's features: a catalogue site has no
 * cart, a company site has no search, department bar or account. The
 * announcement bar is the same in all of them.
 */
export async function Header() {
  const [categories, store] = await Promise.all([getCategories(), getStore()]);
  const { theme, navigation, features, site } = store;
  const layout = theme.layout.header;
  const whatsappHref = store.whatsapp ? whatsappLink(store.whatsapp) : null;
  // The button is configured by the shop; only a safe link is ever rendered.
  const cta = site.headerCta && safeHref(site.headerCta.href) && site.headerCta.label.trim() ? site.headerCta : null;
  const simple = layout === "simple";
  const departments = features.products && !simple;

  const menu = (
    <MobileMenu
      categories={features.products ? categories : []}
      phone={store.phone}
      whatsappHref={whatsappHref}
      links={navigation.header}
      features={features}
      cta={cta}
      title={store.name}
    />
  );
  const logo = <Logo name={store.name} tagline={store.tagline} logoUrl={store.logoUrl} />;
  const actions = (
    <>
      {features.search && (
        <Suspense>
          <MobileSearch />
        </Suspense>
      )}
      {features.accounts && <AccountButton />}
      {features.cart && <CartButton />}
    </>
  );
  const search = (className: string) =>
    features.search ? (
      <Suspense fallback={<div className="hidden md:block h-11 flex-1" />}>
        <SearchBox revealOnScroll fly className={className} />
      </Suspense>
    ) : null;
  /** Without a department bar to carry them, the shop's own links sit in the main row. */
  const inlineLinks = !departments && !simple ? <HeaderLinks links={navigation.header} cta={null} className="hidden lg:block" /> : null;
  const sideCta = !simple && cta && (
    <NavAnchor href={cta.href} className={buttonClass("primary", "md", "ml-2 max-md:hidden")}>
      {cta.label}
    </NavAnchor>
  );

  return (
    <>
      <AnnouncementBar announcement={theme.announcement} />
      <header
        className={`${theme.layout.stickyHeader ? "sticky top-0" : "relative"} z-40 bg-paper shadow-[0_1px_0_var(--color-galv),0_6px_16px_-10px_color-mix(in_srgb,var(--color-ink)_25%,transparent)]`}
      >
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-[var(--radius-tag)] focus:bg-brass focus:px-3 focus:py-2 focus:font-semibold focus:text-ink"
        >
          Skip to content
        </a>

        {layout === "classic" && (
          <div className="bg-ink text-xs text-white/85 sm:text-sm">
            <div className="mx-auto flex max-w-7xl items-center justify-end gap-4 px-4 py-1.5 max-md:hidden">
              {store.phone && (
                <a href={`tel:${store.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1.5 hover:text-white">
                  <Phone className="size-3.5" aria-hidden /> {store.phone}
                </a>
              )}
              {whatsappHref && (
                <a href={whatsappHref} className="hover:text-white" target="_blank" rel="noopener">
                  WhatsApp us
                </a>
              )}
              <Link href="/branches" className="hover:text-white">
                Branches
              </Link>
            </div>
          </div>
        )}

        {simple ? (
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:gap-4">
            {logo}
            <HeaderLinks links={navigation.header} cta={cta} className="ml-auto hidden items-center gap-6 lg:flex" />
            <div className="ml-auto flex items-center lg:hidden">{menu}</div>
          </div>
        ) : layout === "centered" ? (
          <>
            <div className="mx-auto grid max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-3">
              <div className="flex items-center">{menu}</div>
              {logo}
              <div className="flex items-center justify-end">
                {inlineLinks}
                {actions}
                {sideCta}
              </div>
            </div>
            {features.search && <div className="mx-auto hidden max-w-7xl px-4 pb-3 md:block">{search("mx-auto max-w-2xl")}</div>}
          </>
        ) : (
          <div className={`mx-auto flex max-w-7xl items-center gap-2 px-4 sm:gap-4 ${layout === "compact" ? "py-2" : "py-3"}`}>
            {menu}
            {logo}
            {search("hidden md:block flex-1 max-w-2xl mx-auto")}
            {inlineLinks}
            <div className={`ml-auto flex items-center ${features.search ? "md:ml-0" : ""}`}>
              {actions}
              {sideCta}
            </div>
          </div>
        )}
        {departments && <DeptNav categories={categories} links={navigation.header} showTrade={features.accounts} />}
      </header>
    </>
  );
}
