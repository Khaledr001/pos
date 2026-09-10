import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetPortal = DialogPrimitive.Portal;
const SheetClose = DialogPrimitive.Close;

const SheetOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      // Light touch on purpose: the drawer only covers part of the screen, so
      // the table stays half-visible underneath — a heavy blur/scrim there
      // reads as muddy rather than layered.
      "fixed inset-0 z-50 bg-black/30 backdrop-blur-[1px]",
      "data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out",
      className,
    )}
    {...props}
  />
));
SheetOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * Right-side slide-in panel — the same Radix Dialog primitive `Dialog` uses,
 * laid out as a drawer instead of a centered modal.
 *
 * A flex column, NOT a single scrolling box: the header and footer stay put
 * while only the body scrolls. Sticky children inside one padded scroller
 * leave a gap above themselves that content slides through, which is why
 * this is structural rather than a `sticky top-0` on the header.
 */
const SheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed inset-y-0 right-0 z-50 flex h-full w-full flex-col overflow-hidden border-l border-border bg-card shadow-2xl sm:max-w-lg md:max-w-xl lg:max-w-2xl",
        // drawer-in/out are defined in globals.css at 0.3s ease-in-out, the
        // same curve and duration the sidebar collapses with.
        //
        // NOT tailwindcss-animate's `animate-in` / `slide-in-from-right`:
        // that plugin isn't installed (this is Tailwind v4), so those classes
        // emit no CSS at all and the panel simply appeared instantly.
        "data-[state=open]:animate-drawer-in data-[state=closed]:animate-drawer-out",
        className,
      )}
      {...props}
    >
      {children}
      {/* z-20 keeps this above the header, which needs its own stacking context
          to sit over the scrolling body. */}
      <DialogPrimitive.Close className="absolute right-3.5 top-3.5 z-20 rounded-lg p-1 text-muted-foreground opacity-70 ring-offset-background transition-opacity hover:bg-muted hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </SheetPortal>
));
SheetContent.displayName = DialogPrimitive.Content.displayName;

/** Fixed top region. `pr-12` keeps content clear of the close button. */
const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "z-10 shrink-0 border-b border-border bg-card px-4 py-4 pr-12 sm:px-6 sm:pr-12",
      className,
    )}
    {...props}
  />
);
SheetHeader.displayName = "SheetHeader";

/** The only scrolling region, so the header and footer never move. */
const SheetBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-5 scrollbar-thin sm:px-6", className)}
    {...props}
  />
);
SheetBody.displayName = "SheetBody";

/** Fixed bottom action bar. */
const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "shrink-0 flex flex-col-reverse gap-2 border-t border-border bg-card px-4 py-3 sm:flex-row sm:justify-end sm:px-6",
      className,
    )}
    {...props}
  />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-base font-bold leading-none tracking-tight text-foreground sm:text-lg", className)}
    {...props}
  />
));
SheetTitle.displayName = DialogPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-xs text-muted-foreground sm:text-sm", className)} {...props} />
));
SheetDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
