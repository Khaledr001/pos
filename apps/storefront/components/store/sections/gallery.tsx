import type { HomeSectionSettings } from "@devsfleet/shared-types";
import { safeImageSrc } from "@/lib/links";
import { GalleryGrid } from "./gallery-grid";
import { clean, SecHeading, SectionFrame } from "./section-header";

export function Gallery({ id, settings, align }: { id: string; settings: HomeSectionSettings["gallery"]; align?: "left" | "center" }) {
  const images = (settings.items ?? []).flatMap((item) => {
    const src = safeImageSrc(item.imageUrl);
    return src ? [{ src, alt: item.alt?.trim() ?? "", caption: item.caption?.trim() || null }] : [];
  });
  if (images.length === 0) return null;
  const heading = `gallery-${id}`;
  const title = clean(settings.title);
  return (
    <SectionFrame>
      <section className="mt-14" aria-labelledby={title ? heading : undefined} aria-label={title ? undefined : "Gallery"}>
        <SecHeading id={heading} title={title} centered={align === "center"} />
        <GalleryGrid images={images} columns={settings.columns ?? 3} />
      </section>
    </SectionFrame>
  );
}
