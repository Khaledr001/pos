import type { HomeSectionSettings } from "@devsfleet/shared-types";
import { NavAnchor } from "@/components/store/nav-anchor";
import { safeHref, safeImageSrc } from "@/lib/links";
import { clean, SecHeading, SectionFrame } from "./section-header";

export function Logos({ id, settings, align }: { id: string; settings: HomeSectionSettings["logos"]; align?: "left" | "center" }) {
  const items = (settings.items ?? []).flatMap((item) => {
    const src = safeImageSrc(item.imageUrl);
    return src && item.name.trim() ? [{ ...item, src }] : [];
  });
  if (items.length === 0) return null;
  const heading = `logos-${id}`;
  const title = clean(settings.title);
  return (
    <SectionFrame>
      <section className="mt-14" aria-labelledby={title ? heading : undefined} aria-label={title ? undefined : "Clients and partners"}>
        <SecHeading id={heading} title={title} centered={align === "center"} />
        <ul className="grid grid-cols-2 items-center gap-x-8 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">
          {items.map((item, i) => {
            // eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded logos of unknown size
            const img = <img src={item.src} alt={item.name} loading="lazy" className="mx-auto max-h-12 w-auto max-w-full object-contain opacity-80 grayscale transition hover:opacity-100 hover:grayscale-0" />;
            const href = safeHref(item.href);
            return <li key={`${item.name}-${i}`}>{href ? <NavAnchor href={href}>{img}</NavAnchor> : img}</li>;
          })}
        </ul>
      </section>
    </SectionFrame>
  );
}
