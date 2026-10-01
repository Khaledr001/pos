import { Providers } from "@/components/providers";
import { Analytics } from "@/components/store/analytics";
import { Footer } from "@/components/store/footer";
import { Header } from "@/components/store/header";
import { WhatsAppButton } from "@/components/store/whatsapp-button";

// Rendered per request: pages read live prices and stock through the tagged
// fetch cache, which the API refreshes on change. This also lets the app build
// without the API running.
export const dynamic = "force-dynamic";

export default function StoreLayout({ children }: LayoutProps<"/">) {
  return (
    <Providers>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-paper focus:p-3">
        Skip to content
      </a>
      <Header />
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer />
      <WhatsAppButton />
      <Analytics />
    </Providers>
  );
}
