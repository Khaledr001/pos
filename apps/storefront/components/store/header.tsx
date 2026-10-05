import { Phone } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { getCategories, getStore } from "@/lib/data";
import { whatsappLink } from "@/lib/format";
import { DeptNav, MobileMenu } from "./dept-nav";
import { AccountButton, CartButton } from "./header-actions";
import { Logo } from "./logo";
import { MobileSearch } from "./mobile-search";
import { SearchBox } from "./search-box";

export async function Header() {
  const [categories, store] = await Promise.all([getCategories(), getStore()]);
  return (
    <header className="sticky top-0 z-40 bg-paper shadow-[0_1px_0_var(--color-galv),0_6px_16px_-10px_rgb(28_37_48/0.25)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-[var(--radius-tag)] focus:bg-brass focus:px-3 focus:py-2 focus:font-semibold focus:text-ink"
      >
        Skip to content
      </a>
      <div className="bg-ink text-xs text-white/85 sm:text-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-1.5">
          <p className="min-w-0 flex-1 truncate max-md:text-center">Delivery to all 7 emirates. Store pickup in Dubai, Sharjah and Abu Dhabi.</p>
          <div className="hidden md:flex items-center gap-4 shrink-0">
            {store.phone && (
              <a href={`tel:${store.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1.5 hover:text-white">
                <Phone className="size-3.5" aria-hidden /> {store.phone}
              </a>
            )}
            {store.whatsapp && (
              <a href={whatsappLink(store.whatsapp)} className="hover:text-white" target="_blank" rel="noopener">
                WhatsApp us
              </a>
            )}
            <Link href="/branches" className="hover:text-white">
              Branches
            </Link>
          </div>
        </div>
      </div>

      <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-3 sm:gap-4">
        <MobileMenu
          categories={categories}
          phone={store.phone}
          whatsappHref={store.whatsapp ? whatsappLink(store.whatsapp) : null}
        />
        <Logo name={store.name} tagline={store.tagline} logoUrl={store.logoUrl} />
        <Suspense fallback={<div className="hidden md:block h-11 flex-1" />}>
          <SearchBox revealOnScroll fly className="hidden md:block flex-1 max-w-2xl mx-auto" />
        </Suspense>
        <div className="ml-auto flex items-center md:ml-0">
          <Suspense>
            <MobileSearch />
          </Suspense>
          <AccountButton />
          <CartButton />
        </div>
      </div>
      <DeptNav categories={categories} />
    </header>
  );
}
