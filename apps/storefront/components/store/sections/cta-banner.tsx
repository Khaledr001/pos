import type { HomeSectionSettings } from "@devsfleet/shared-types";
import type { StoreInfo } from "@devsfleet/storefront-client";
import { MessageCircle } from "lucide-react";
import { NavAnchor } from "@/components/store/nav-anchor";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { whatsappLink } from "@/lib/format";
import { safeHref } from "@/lib/links";
import { clean, SectionFrame } from "./section-header";

/** A panel with its own background (see `.cta-panel` in globals.css), so it stands out on a plain or a coloured band. */
export function CtaBanner({
  id,
  settings,
  store,
  align,
}: {
  id: string;
  settings: HomeSectionSettings["cta_banner"];
  store: StoreInfo;
  align?: "left" | "center";
}) {
  const headline = clean(settings.headline);
  if (!headline) return null;
  const text = clean(settings.text);
  const primary = safeHref(settings.ctaHref);
  const secondary = safeHref(settings.secondaryHref);
  const whatsapp = settings.showWhatsapp && store.whatsapp ? whatsappLink(store.whatsapp, `Hello ${store.name}, `) : null;
  const centered = align !== "left";
  const heading = `cta-${id}`;
  return (
    <SectionFrame>
      <section aria-labelledby={heading} className="cta-panel blueprint mt-14 rounded-[var(--radius-panel)] bg-ink p-8 text-white sm:p-12">
        <div className={cn("max-w-3xl", centered && "mx-auto text-center")}>
          <h2 id={heading} className="text-3xl sm:text-4xl">
            {headline}
          </h2>
          {text && <p className="mt-3 text-lg text-white/85">{text}</p>}
          {(primary || secondary || whatsapp) && (
            <div className={cn("mt-6 flex flex-wrap gap-3", centered && "justify-center")}>
              {primary && (
                <NavAnchor href={primary} className={buttonClass("brass", "lg")}>
                  {clean(settings.ctaLabel) ?? "Get in touch"}
                </NavAnchor>
              )}
              {secondary && (
                <NavAnchor href={secondary} className={buttonClass("onDark", "lg")}>
                  {clean(settings.secondaryLabel) ?? "Learn more"}
                </NavAnchor>
              )}
              {whatsapp && (
                <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={buttonClass("onDark", "lg")}>
                  <MessageCircle className="size-5" aria-hidden /> WhatsApp us
                </a>
              )}
            </div>
          )}
        </div>
      </section>
    </SectionFrame>
  );
}
