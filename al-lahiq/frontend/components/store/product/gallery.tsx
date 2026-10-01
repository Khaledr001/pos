"use client";

import Image from "next/image";
import { useState } from "react";
import { ProductImage } from "@/components/ui/product-image";
import { cn } from "@/lib/cn";

export function Gallery({ images, name, brand }: { images: { url: string; alt: string }[]; name: string; brand?: string | null }) {
  const [index, setIndex] = useState(0);
  if (images.length === 0) {
    return <ProductImage image={null} name={name} brand={brand} className="rounded-[var(--radius-panel)] border border-galv" />;
  }
  const current = images[index];
  return (
    <div>
      <div className="relative aspect-square overflow-hidden rounded-[var(--radius-panel)] border border-galv bg-paper">
        <Image src={current.url} alt={current.alt} fill priority sizes="(min-width: 1024px) 50vw, 100vw" className="object-contain p-6" />
      </div>
      {images.length > 1 && (
        <ul className="mt-3 flex gap-2 overflow-x-auto">
          {images.map((img, i) => (
            <li key={img.url}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Show image ${i + 1} of ${images.length}`}
                aria-current={i === index ? "true" : undefined}
                className={cn(
                  "relative block size-20 overflow-hidden rounded-[var(--radius-tag)] border bg-paper",
                  i === index ? "border-ink" : "border-galv",
                )}
              >
                <Image src={img.url} alt="" fill sizes="80px" className="object-contain p-1" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
