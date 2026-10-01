import Image from "next/image";
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
        <div
          role="img"
          aria-label={name}
          className="absolute inset-0 flex items-center justify-center bg-[repeating-linear-gradient(135deg,var(--color-sheet)_0_10px,#eef1f3_10px_20px)] p-6"
        >
          <span className="font-cond text-3xl font-bold text-steel-light/80 text-center leading-none">{brand ?? "No photo yet"}</span>
        </div>
      )}
    </div>
  );
}
