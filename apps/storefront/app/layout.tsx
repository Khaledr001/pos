import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed, Inter, Playfair_Display, Poppins } from "next/font/google";
import { StoreConfigProvider } from "@/lib/store-config";
import { getStore } from "@/lib/data";
import { siteOrigin } from "@/lib/site";
import { FONT_VARIABLES, themeColor, themeCss } from "@/lib/theme";
import "./globals.css";

// Only the pair a shop chose is applied to <html> below, and only Barlow (the
// default pair) is preloaded, so a shop never downloads fonts it does not use.
const barlow = Barlow({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], preload: false });
const poppins = Poppins({ variable: "--font-poppins", subsets: ["latin"], weight: ["400", "500", "600", "700"], preload: false });
const playfair = Playfair_Display({ variable: "--font-playfair", subsets: ["latin"], preload: false });

const FONT_CLASS: Record<string, string> = {
  "--font-barlow": barlow.variable,
  "--font-barlow-condensed": barlowCondensed.variable,
  "--font-inter": inter.variable,
  "--font-poppins": poppins.variable,
  "--font-playfair": playfair.variable,
};

/** Titled with the tenant's own store name: one storefront build serves every shop. */
export async function generateMetadata(): Promise<Metadata> {
  const [store, site] = await Promise.all([getStore(), siteOrigin()]);
  const { faviconUrl, shareImageUrl } = store.theme;
  const description = `Shop ${store.name} online. Prices include ${store.region.taxLabel}; delivery or store pickup.`;
  return {
    metadataBase: new URL(site),
    title: {
      default: store.tagline ? `${store.name} — ${store.tagline}` : store.name,
      template: `%s | ${store.name}`,
    },
    description,
    ...(faviconUrl ? { icons: { icon: faviconUrl } } : {}),
    openGraph: { siteName: store.name, description, ...(shareImageUrl ? { images: [shareImageUrl] } : {}) },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const store = await getStore();
  return { themeColor: themeColor(store.theme) };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const store = await getStore();
  const { theme, region } = store;
  const fonts = (FONT_VARIABLES[theme.font] ?? FONT_VARIABLES.barlow).map((v) => FONT_CLASS[v]).join(" ");
  return (
    <html lang={region.formatLocale} className={`${fonts} h-full antialiased`}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeCss(theme) }} />
      </head>
      {/* Browser extensions (Grammarly, password managers) stamp attributes onto <body> before React hydrates. */}
      <body
        className="min-h-full flex flex-col"
        data-header={theme.layout.header}
        data-card={theme.layout.productCard}
        data-footer={theme.layout.footer}
        suppressHydrationWarning
      >
        <StoreConfigProvider currency={store.currency} locale={region.formatLocale} timezone={store.timezone} region={region}>
          {children}
        </StoreConfigProvider>
      </body>
    </html>
  );
}
