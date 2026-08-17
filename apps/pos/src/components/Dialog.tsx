import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * Modal built on the native `<dialog>` element.
 *
 * Native rather than hand-rolled because `showModal()` gives focus trapping,
 * inertness of the page behind, and Escape handling for free — three things
 * that are easy to get subtly wrong and that matter here, since a cashier
 * tabbing out of a payment dialog into the cart behind it would be a real
 * source of mistakes.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "md",
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg";
  /** false for a step the cashier must resolve, e.g. counting the drawer. */
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    const onCancel = (event: Event) => {
      event.preventDefault(); // Escape must not close a blocking step.
      if (dismissible) onClose();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, [dismissible, onClose]);

  const widths = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl" };

  return (
    <dialog
      ref={ref}
      className={`panel m-auto w-full ${widths[width]} bg-pos-panel p-0 text-pos-text backdrop:bg-black/70 backdrop:backdrop-blur-[2px]`}
      aria-labelledby="dialog-title"
    >
      <div className="flex items-start justify-between gap-4 border-b border-pos-border px-5 py-4">
        <div>
          <h2 id="dialog-title" className="text-base font-semibold">
            {title}
          </h2>
          {description && (
            <p className="mt-0.5 text-[13px] text-pos-text-2">{description}</p>
          )}
        </div>
        {dismissible && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-pos-text-3 transition-colors hover:bg-pos-raised hover:text-pos-text"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <div className="max-h-[65vh] overflow-y-auto px-5 py-4">{children}</div>

      {footer && (
        <div className="flex justify-end gap-2 border-t border-pos-border px-5 py-3.5">
          {footer}
        </div>
      )}
    </dialog>
  );
}
