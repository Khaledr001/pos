"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * Native <dialog> modal: focus trapping, Esc to close and the backdrop come
 * from the browser. Children mount only while open, so forms start fresh.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const width = { sm: "max-w-md", md: "max-w-2xl", lg: "max-w-4xl" }[size];
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="modal-title"
      className={cn(
        "m-auto w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-[var(--radius-panel)] border border-galv bg-paper p-0 text-ink shadow-2xl backdrop:bg-ink/50",
        width,
      )}
    >
      {open && (
        <div>
          <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-galv bg-paper px-5 py-4">
            <div>
              <h2 id="modal-title" className="text-2xl">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-sm text-steel">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 rounded-[var(--radius-tag)] p-1.5 text-steel hover:bg-galv/60 hover:text-ink"
            >
              <X className="size-5" />
            </button>
          </header>
          <div className="px-5 py-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

/** "Are you sure?" dialog for destructive actions. */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  children,
  confirmLabel,
  loading,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  loading?: boolean;
  error?: string | null;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className="flex flex-col gap-4">
        {children && <div className="text-[15px] text-ink/85">{children}</div>}
        {error && (
          <p role="alert" className="rounded-[var(--radius-tag)] border border-signal/30 bg-signal-tint px-3 py-2 text-sm text-signal">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Keep it
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
