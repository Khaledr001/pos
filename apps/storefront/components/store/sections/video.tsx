import type { HomeSectionSettings } from "@devsfleet/shared-types";
import { videoEmbedSrc } from "@/lib/embeds";
import { clean, SecHeading, SectionFrame } from "./section-header";

export function Video({ id, settings, align }: { id: string; settings: HomeSectionSettings["video"]; align?: "left" | "center" }) {
  const src = videoEmbedSrc(settings.url);
  if (!src) return null;
  const heading = `video-${id}`;
  const title = clean(settings.title);
  return (
    <SectionFrame>
      <section className="mt-14" aria-labelledby={title ? heading : undefined} aria-label={title ? undefined : "Video"}>
        <SecHeading id={heading} title={title} centered={align === "center"} />
        <div className="mx-auto max-w-4xl">
          <div className="relative aspect-video overflow-hidden rounded-[var(--radius-panel)] bg-ink">
            <iframe
              src={src}
              title={title ?? clean(settings.caption) ?? "Video"}
              loading="lazy"
              allow="fullscreen; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
              className="absolute inset-0 size-full border-0"
            />
          </div>
          {settings.caption && <p className="sec-muted mt-2 text-center text-sm">{settings.caption}</p>}
        </div>
      </section>
    </SectionFrame>
  );
}
