import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import { getStore } from "@/lib/data";
import { siteOrigin } from "@/lib/site";
import "./globals.css";

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

/** Titled with the tenant's own store name: one storefront build serves every shop. */
export async function generateMetadata(): Promise<Metadata> {
  const [store, site] = await Promise.all([getStore(), siteOrigin()]);
  return {
    metadataBase: new URL(site),
    title: {
      default: store.tagline ? `${store.name} — ${store.tagline}` : store.name,
      template: `%s | ${store.name}`,
    },
    description: `Shop ${store.name} online. Prices include VAT; delivery across the UAE or store pickup.`,
  };
}

export const viewport: Viewport = {
  themeColor: "#1c2530",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-AE" className={`${barlow.variable} ${barlowCondensed.variable} h-full antialiased`}>
      {/* Browser extensions (Grammarly, password managers) stamp attributes onto <body> before React hydrates. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>{children}</body>
    </html>
  );
}
