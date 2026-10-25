import type { FooterColumn } from "@devsfleet/shared-types";
import Link from "next/link";
import { getCategories, getStore } from "@/lib/data";
import { busiestFirst, displayName, whatsappLink } from "@/lib/format";
import { Logo } from "./logo";
import { NavAnchor } from "./nav-anchor";
import { SocialLinkList } from "./social-links";

/** Link and text colours for each footer layout. Dark is the original look. */
const TONES = {
  dark: {
    root: "bg-ink text-white/80",
    heading: "text-white",
    link: "hover:text-white",
    strong: "text-white",
    muted: "text-white/60",
    rule: "border-white/10",
  },
  light: {
    root: "border-t border-galv bg-paper text-steel",
    heading: "text-ink",
    link: "hover:text-ink",
    strong: "text-ink",
    muted: "text-steel-light",
    rule: "border-galv",
  },
} as const;

/** Tailwind needs whole class names, so the column count is spelled out. */
const GRID_COLS: Record<number, string> = {
  0: "lg:grid-cols-4",
  1: "lg:grid-cols-3",
  2: "lg:grid-cols-4",
  3: "lg:grid-cols-5",
  4: "lg:grid-cols-6",
};

export async function Footer() {
  const [categories, store] = await Promise.all([getCategories(), getStore()]);
  const { theme, navigation, region } = store;
  const tone = TONES[theme.layout.footer] ?? TONES.dark;
  const inverted = theme.layout.footer !== "light";

  const defaultColumns: FooterColumn[] = [
    {
      title: "Help",
      links: [
        { label: "Track an order", href: "/track" },
        { label: "Contact us", href: "/contact" },
      ],
    },
    {
      title: "Company",
      links: [
        { label: "About us", href: "/pages/about" },
        { label: "Branches & opening hours", href: "/branches" },
        { label: "Trade accounts", href: "/account/trade" },
        { label: "Guides", href: "/blog" },
      ],
    },
  ];
  const columns = navigation.footerColumns.length > 0 ? navigation.footerColumns : defaultColumns;
  const usingDefaults = navigation.footerColumns.length === 0;
  const legal =
    navigation.legal.length > 0
      ? navigation.legal
      : [
          { label: "Privacy", href: "/pages/privacy" },
          { label: "Terms", href: "/pages/terms" },
        ];

  return (
    <footer className={`mt-16 ${tone.root}`}>
      <div className={`mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:grid-cols-2 ${GRID_COLS[usingDefaults ? 2 : columns.length]}`}>
        <div className="space-y-3">
          <Logo name={store.name} tagline={store.tagline} logoUrl={store.logoUrl} inverted={inverted} />
          {navigation.footerNote && <p className="text-sm">{navigation.footerNote}</p>}
          {store.address && <p className="text-sm">{store.address}</p>}
          {store.phone && <p className="text-sm">{store.phone}</p>}
          {store.email && (
            <a href={`mailto:${store.email}`} className={`block text-sm ${tone.link}`}>
              {store.email}
            </a>
          )}
          {store.trn && (
            <p className={`text-sm ${tone.muted}`}>
              {region.taxIdLabel} {store.trn}
            </p>
          )}
          <SocialLinkList social={theme.social} className={`pt-1 ${tone.strong}`} />
        </div>
        <div>
          <h2 className={`mb-3 text-lg ${tone.heading}`}>Shop</h2>
          <ul className="space-y-1.5 text-sm">
            {busiestFirst(categories)
              .slice(0, 6)
              .map((c) => (
                <li key={c.slug}>
                  <Link href={`/category/${c.slug}`} className={tone.link}>
                    {displayName(c.name)}
                  </Link>
                </li>
              ))}
            <li className="pt-1">
              <Link href="/departments" className={`font-semibold hover:underline ${tone.strong}`}>
                All departments
              </Link>
            </li>
            <li>
              <Link href="/brands" className={tone.link}>
                All brands
              </Link>
            </li>
          </ul>
        </div>
        {columns.map((column) => (
          <div key={column.title}>
            <h2 className={`mb-3 text-lg ${tone.heading}`}>{column.title}</h2>
            <ul className="space-y-1.5 text-sm">
              {column.links.map((link) => (
                <li key={`${link.label}-${link.href}`}>
                  <NavAnchor href={link.href} className={tone.link}>
                    {link.label}
                  </NavAnchor>
                </li>
              ))}
              {usingDefaults && column.title === "Company" && store.whatsapp && (
                <li>
                  <a href={whatsappLink(store.whatsapp)} target="_blank" rel="noopener" className={tone.link}>
                    WhatsApp
                  </a>
                </li>
              )}
            </ul>
          </div>
        ))}
      </div>
      <div className={`border-t ${tone.rule}`}>
        <div className={`mx-auto flex max-w-7xl flex-col gap-2 px-4 py-4 text-xs sm:flex-row sm:justify-between ${tone.muted}`}>
          <p>
            © {new Date().getFullYear()} {store.legalName || store.name}. Prices in {store.currency} include {region.taxLabel}.
          </p>
          <p className="flex gap-4">
            {legal.map((link) => (
              <NavAnchor key={`${link.label}-${link.href}`} href={link.href} className={tone.link}>
                {link.label}
              </NavAnchor>
            ))}
          </p>
        </div>
      </div>
    </footer>
  );
}
