import type { HomeSectionSettings } from "@devsfleet/shared-types";
import { Markdown } from "@/components/store/markdown";
import { SectionFrame } from "./section-header";

export function RichText({ id, settings }: { id: string; settings: HomeSectionSettings["rich_text"] }) {
  const body = settings.body?.trim();
  if (!body) return null;
  const heading = `text-${id}`;
  return (
    <SectionFrame>
      <section className="mt-14" aria-labelledby={settings.title ? heading : undefined}>
        {settings.title && (
          <h2 id={heading} className="mb-4 text-3xl">
            {settings.title}
          </h2>
        )}
        <Markdown>{body}</Markdown>
      </section>
    </SectionFrame>
  );
}
