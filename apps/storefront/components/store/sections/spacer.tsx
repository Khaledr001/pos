import type { HomeSectionSettings } from "@devsfleet/shared-types";
import { cn } from "@/lib/cn";
import { SectionFrame } from "./section-header";

const HEIGHT = { sm: "h-4", md: "h-10", lg: "h-20" } as const;

export function Spacer({ settings }: { settings: HomeSectionSettings["spacer"] }) {
  const height = HEIGHT[settings.height ?? "md"] ?? HEIGHT.md;
  return (
    <SectionFrame>
      {settings.divider ? (
        <div className={cn("flex items-center", height)}>
          <hr className="sec-rule w-full border-t" />
        </div>
      ) : (
        <div aria-hidden className={height} />
      )}
    </SectionFrame>
  );
}
