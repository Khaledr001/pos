import { Phone } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { getCategories, getStore } from "@/lib/data";
import { whatsappLink } from "@/lib/format";
import { DeptNav, MobileMenu } from "./dept-nav";
import { AccountButton, CartButton } from "./header-actions";
import { Logo } from "./logo";
import { SearchBox } from "./search-box";

export async function Header() {
  const [categories, store] = await Promise.all([getCategories(), getStore()]);
  return (
    <header className="sticky top-0 z-40 bg-paper shadow-[0_1px_0_var(--color-galv)]">
      <div className="bg-ink text-white/85 text-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-1.5">
          <p className="truncate">Delivery to all 7 emirates. Store pickup in Dubai, Sharjah and Abu Dhabi.</p>
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
        <MobileMenu categories={categories} />
        <Logo />
        <Suspense fallback={<div className="hidden md:block h-12 flex-1" />}>
          <SearchBox hideOnHome className="hidden md:block flex-1 max-w-2xl mx-auto" />
        </Suspense>
        <div className="ml-auto flex items-center md:ml-0">
          <AccountButton />
          <CartButton />
        </div>
      </div>
      <div className="px-4 pb-3 md:hidden empty:hidden">
        <Suspense>
          <SearchBox hideOnHome />
        </Suspense>
      </div>
      <DeptNav categories={categories} />
    </header>
  );
}
