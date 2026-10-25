import type { HomeSectionSettings } from "@devsfleet/shared-types";
import { Navigation } from "lucide-react";
import { getBranches } from "@/lib/data";
import { mapEmbedSrc, mapsLink } from "@/lib/embeds";
import { cn } from "@/lib/cn";
import { clean, SecHeading, SectionFrame } from "./section-header";

const HEIGHT = { sm: "h-64", md: "h-96", lg: "h-[34rem]" } as const;

export async function MapSection({ id, settings, align }: { id: string; settings: HomeSectionSettings["map"]; align?: "left" | "center" }) {
  const heading = `map-${id}`;
  const title = clean(settings.title);
  const embed = mapEmbedSrc(settings.embedUrl);
  const mode = settings.mode ?? (embed ? "embed" : "branches");

  if (mode === "embed") {
    if (!embed) return null;
    return (
      <SectionFrame>
        <section className="mt-14" aria-labelledby={title ? heading : undefined} aria-label={title ? undefined : "Map"}>
          <SecHeading id={heading} title={title} centered={align === "center"} />
          <iframe
            src={embed}
            title={title ?? "Map"}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-popups"
            className={cn("w-full rounded-[var(--radius-panel)] border-0", HEIGHT[settings.height ?? "md"] ?? HEIGHT.md)}
          />
        </section>
      </SectionFrame>
    );
  }

  const branches = await getBranches();
  if (branches.length === 0) return null;
  return (
    <SectionFrame>
      <section className="mt-14" aria-labelledby={title ? heading : undefined} aria-label={title ? undefined : "Our locations"}>
        <SecHeading id={heading} title={title} centered={align === "center"} />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {branches.map((b) => (
            <li key={b.id} className="sec-card flex flex-col p-5">
              <h3 className="font-cond text-xl font-semibold">{b.name}</h3>
              {b.address && <p className="sec-muted mt-1 text-[15px]">{b.address}</p>}
              <a
                href={mapsLink(b)}
                target="_blank"
                rel="noopener noreferrer"
                className="sec-accent mt-3 inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
              >
                <Navigation className="size-4" aria-hidden /> Open in maps
                <span className="sr-only"> ({b.name}, opens a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </SectionFrame>
  );
}
