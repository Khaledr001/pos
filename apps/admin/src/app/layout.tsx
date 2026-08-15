import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "DevsFleet",
    template: "%s · DevsFleet",
  },
  description: "POS, inventory and WhatsApp AI for hardware and electrical retail",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0d10" },
  ],
};

/**
 * Root layout.
 *
 * `lang` and `dir` are hardcoded to English for now. Once the locale switcher
 * lands they come from the tenant's settings — Arabic and Urdu are in the
 * enabled set, and both are right-to-left, so `dir` has to be dynamic rather
 * than assumed. Keeping the attribute here (instead of on a nested div) is what
 * makes that a one-line change later.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body className="min-h-dvh bg-[--color-bg] text-[--color-fg] antialiased">
        {children}
      </body>
    </html>
  );
}
