import Link from "next/link";
import { getCategories, getStore } from "@/lib/data";
import { whatsappLink } from "@/lib/format";
import { Logo } from "./logo";

export async function Footer() {
  const [categories, store] = await Promise.all([getCategories(), getStore()]);
  return (
    <footer className="mt-16 bg-ink text-white/80">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-3">
          <Logo inverted />
          <p className="text-sm">{store.address}</p>
          {store.phone && <p className="text-sm">{store.phone}</p>}
          {store.email && (
            <a href={`mailto:${store.email}`} className="block text-sm hover:text-white">
              {store.email}
            </a>
          )}
          {store.trn && <p className="text-sm text-white/60">TRN {store.trn}</p>}
        </div>
        <div>
          <h2 className="mb-3 text-lg text-white">Shop</h2>
          <ul className="space-y-1.5 text-sm">
            {categories.map((c) => (
              <li key={c.slug}>
                <Link href={`/category/${c.slug}`} className="hover:text-white">
                  {c.name}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/brands" className="hover:text-white">
                All brands
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <h2 className="mb-3 text-lg text-white">Help</h2>
          <ul className="space-y-1.5 text-sm">
            <li><Link href="/track" className="hover:text-white">Track an order</Link></li>
            <li><Link href="/pages/delivery-returns" className="hover:text-white">Delivery &amp; returns</Link></li>
            <li><Link href="/pages/warranty" className="hover:text-white">Warranty</Link></li>
            <li><Link href="/pages/faq" className="hover:text-white">FAQ</Link></li>
            <li><Link href="/contact" className="hover:text-white">Contact us</Link></li>
          </ul>
        </div>
        <div>
          <h2 className="mb-3 text-lg text-white">Company</h2>
          <ul className="space-y-1.5 text-sm">
            <li><Link href="/pages/about" className="hover:text-white">About us</Link></li>
            <li><Link href="/branches" className="hover:text-white">Branches &amp; opening hours</Link></li>
            <li><Link href="/account/trade" className="hover:text-white">Trade accounts</Link></li>
            <li><Link href="/blog" className="hover:text-white">Guides</Link></li>
            {store.whatsapp && (
              <li>
                <a href={whatsappLink(store.whatsapp)} target="_blank" rel="noopener" className="hover:text-white">
                  WhatsApp
                </a>
              </li>
            )}
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-4 text-xs text-white/60 sm:flex-row sm:justify-between">
          <p>
            © {new Date().getFullYear()} {store.legalName}. Prices in AED include 5% VAT.
          </p>
          <p className="flex gap-4">
            <Link href="/pages/privacy" className="hover:text-white">Privacy</Link>
            <Link href="/pages/terms" className="hover:text-white">Terms</Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
