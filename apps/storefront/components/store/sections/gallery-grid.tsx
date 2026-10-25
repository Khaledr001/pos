"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

type Img = { src: string; alt: string; caption: string | null };

const COLS = { 2: "grid-cols-2", 3: "grid-cols-2 md:grid-cols-3", 4: "grid-cols-2 md:grid-cols-3 lg:grid-cols-4" } as const;

/**
 * A grid of photos that open in a lightbox. The lightbox is a native <dialog>
 * opened with showModal(), so focus is trapped, Escape closes it and the page
 * behind is inert without any of that being re-implemented here.
 */
export function GalleryGrid({ images, columns }: { images: Img[]; columns: 2 | 3 | 4 }) {
  const [index, setIndex] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => dialogRef.current?.close(), []);
  const step = useCallback((delta: number) => setIndex((i) => (i === null ? i : (i + delta + images.length) % images.length)), [images.length]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (index !== null && !dialog.open) dialog.showModal();
  }, [index]);

  const current = index === null ? null : images[index];

  return (
    <>
      <ul className={cn("grid gap-3", COLS[columns])}>
        {images.map((img, i) => (
          <li key={`${img.src}-${i}`}>
            <figure>
              <button
                type="button"
                onClick={(e) => {
                  openerRef.current = e.currentTarget;
                  setIndex(i);
                }}
                aria-label={`Enlarge image ${i + 1} of ${images.length}${img.alt ? `: ${img.alt}` : ""}`}
                className="group relative block aspect-[4/3] w-full cursor-zoom-in overflow-hidden rounded-[var(--radius-panel)] bg-galv"
              >
                <Image
                  src={img.src}
                  alt={img.alt}
                  fill
                  sizes="(min-width: 1024px) 33vw, 50vw"
                  className="object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none"
                />
              </button>
              {img.caption && <figcaption className="sec-muted mt-1.5 text-sm">{img.caption}</figcaption>}
            </figure>
          </li>
        ))}
      </ul>

      <dialog
        ref={dialogRef}
        aria-label="Image viewer"
        onClose={() => {
          setIndex(null);
          openerRef.current?.focus();
        }}
        onClick={(e) => e.target === dialogRef.current && close()}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") step(1);
          if (e.key === "ArrowLeft") step(-1);
        }}
        className="m-auto h-[min(90vh,60rem)] w-[min(94vw,80rem)] max-w-none overflow-hidden rounded-[var(--radius-panel)] bg-ink p-0 text-white backdrop:bg-black/80"
      >
        {current && (
          <div className="relative flex size-full flex-col">
            <div className="relative min-h-0 flex-1">
              <Image src={current.src} alt={current.alt} fill sizes="94vw" className="object-contain" priority />
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <p aria-live="polite" className="min-w-0 truncate">
                {current.caption ?? current.alt}
              </p>
              <p className="shrink-0 tabular-nums text-white/70">
                {(index ?? 0) + 1} / {images.length}
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close image viewer"
              autoFocus
              className="absolute right-2 top-2 inline-flex size-11 items-center justify-center rounded-full bg-black/50 hover:bg-black/70"
            >
              <X className="size-6" aria-hidden />
            </button>
            {images.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => step(-1)}
                  aria-label="Previous image"
                  className="absolute left-2 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 hover:bg-black/70"
                >
                  <ChevronLeft className="size-6" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => step(1)}
                  aria-label="Next image"
                  className="absolute right-2 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 hover:bg-black/70"
                >
                  <ChevronRight className="size-6" aria-hidden />
                </button>
              </>
            )}
          </div>
        )}
      </dialog>
    </>
  );
}
