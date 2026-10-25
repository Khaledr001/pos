import { SECTION_ANCHOR, type SectionStyle } from "@devsfleet/shared-types";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const PADDING = { none: "", sm: "py-6", md: "py-12", lg: "py-20" } as const;

/**
 * Applies a section's shared look: background, vertical spacing, width, text
 * alignment, an anchor for #links and hiding on phones. A section with no
 * style is returned untouched, so a shop that never opens the style options
 * renders exactly what it always did. The colours live in globals.css, keyed
 * off `data-bg`, so a section only reads `--sec-*` variables and looks right
 * on any band.
 */
export function SectionBand({ style, children }: { style?: SectionStyle; children: ReactNode }) {
  if (!style) return <>{children}</>;
  const background = style.background && style.background !== "none" ? style.background : undefined;
  const padding = style.paddingY ?? (background ? "md" : undefined);
  const banded = background !== undefined || padding !== undefined;
  const anchor = style.anchor && SECTION_ANCHOR.test(style.anchor) ? style.anchor : undefined;
  const centered = style.align === "center";
  const full = style.width === "full";
  if (!banded && !anchor && !style.hideOnMobile && !centered && !full) return <>{children}</>;

  return (
    <div
      id={anchor}
      className={cn("section-band", style.hideOnMobile && "max-md:hidden", padding && PADDING[padding])}
      data-bg={background}
      data-banded={banded ? "true" : undefined}
      data-width={full ? "full" : undefined}
      data-align={centered ? "center" : undefined}
    >
      {children}
    </div>
  );
}
