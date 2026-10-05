import Image from "next/image";
import { Package } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Product photo, or a label-style fallback (brand + name) when staff haven't
 * uploaded one yet, so the grid never shows broken or stock images.
 */
export function ProductImage({
  image,
  name,
  brand,
  sizes = "(min-width: 1024px) 25vw, 50vw",
  priority,
  className,
}: {
  image: { url: string; alt: string } | null;
  name: string;
  brand?: string | null;
  sizes?: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative aspect-square overflow-hidden bg-paper", className)}>
      {image ? (
        <Image src={image.url} alt={image.alt} fill sizes={sizes} priority={priority} className="object-contain p-4" />
      ) : (
        // Quiet on purpose: a grid of missing photos should read as a list of
        // products, not as a wall of grey boxes louder than the names below.
        <div role="img" aria-label={name} className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-sheet/70 p-6">
          <Package className="size-9 text-steel-light/60" strokeWidth={1.5} aria-hidden />
          <span className="text-center font-cond text-lg font-semibold leading-none text-steel-light">{brand ?? "Photo coming soon"}</span>
        </div>
      )}
    </div>
  );
}
