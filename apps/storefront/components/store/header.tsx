import { Phone } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { getCategories, getStore } from "@/lib/data";
import { whatsappLink } from "@/lib/format";
import { AnnouncementBar } from "./announcement-bar";
import { DeptNav, MobileMenu } from "./dept-nav";
import { AccountButton, CartButton } from "./header-actions";
import { Logo } from "./logo";
import { MobileSearch } from "./mobile-search";
import { SearchBox } from "./search-box";

/**
 * The shop's header, in the layout its theme picked:
 *  - classic: contact strip, then logo, search and actions on one row
 *  - centered: logo in the middle, search on its own row beneath
 *  - compact: one slim row, no contact strip
 * The department bar and the announcement bar are the same in all three.
 */
export async function Header() {
  const [categories, store] = await Promise.all([getCategories(), getStore()]);
  const { theme, navigation } = store;
  const layout = theme.layout.header;
  const whatsappHref = store.whatsapp ? whatsappLink(store.whatsapp) : null;

  const menu = <MobileMenu categories={categories} phone={store.phone} whatsappHref={whatsappHref} links={navigation.header} />;
  const logo = <Logo name={store.name} tagline={store.tagline} logoUrl={store.logoUrl} />;
  const actions = (
    <>
      <Suspense>
        <MobileSearch />
      </Suspense>
      <AccountButton />
      <CartButton />
    </>
  );
  const search = (className: string) => (
    <Suspense fallback={<div className="hidden md:block h-11 flex-1" />}>
      <SearchBox revealOnScroll fly className={className} />
    </Suspense>
  );

  return (
    <>
      <AnnouncementBar announcement={theme.announcement} />
      <header className="sticky top-0 z-40 bg-paper shadow-[0_1px_0_var(--color-galv),0_6px_16px_-10px_color-mix(in_srgb,var(--color-ink)_25%,transparent)]">
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

        {layout === "centered" ? (
          <>
            <div className="mx-auto grid max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-3">
              <div className="flex items-center">{menu}</div>
              {logo}
              <div className="flex items-center justify-end">{actions}</div>
            </div>
            <div className="mx-auto hidden max-w-7xl px-4 pb-3 md:block">{search("mx-auto max-w-2xl")}</div>
          </>
        ) : (
          <div className={`mx-auto flex max-w-7xl items-center gap-2 px-4 sm:gap-4 ${layout === "compact" ? "py-2" : "py-3"}`}>
            {menu}
            {logo}
            {search("hidden md:block flex-1 max-w-2xl mx-auto")}
            <div className="ml-auto flex items-center md:ml-0">{actions}</div>
          </div>
        )}
        <DeptNav categories={categories} links={navigation.header} />
      </header>
    </>
  );
}
