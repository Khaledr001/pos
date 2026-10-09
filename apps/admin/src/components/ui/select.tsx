import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp, Search } from "lucide-react";
import { countItems, filterOptions } from "@/lib/select-search";
import { cn } from "@/lib/utils";

/** A list longer than this gets a search box; short ones (Retail / Wholesale / VIP) stay clean. */
const SEARCH_THRESHOLD = 8;

/**
 * Radix only exposes the chosen value to the root, but the list needs it: while
 * filtering, the chosen option must stay mounted or the trigger's label goes blank.
 */
const SelectValueContext = React.createContext<string | undefined>(undefined);
/** True while the list has a search box. Hovering an option must then not steal focus from the box. */
const SearchableContext = React.createContext(false);

function Select({ value: controlled, defaultValue, onValueChange, ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const [inner, setInner] = React.useState(defaultValue);
  const current = controlled ?? inner;
  return (
    <SelectValueContext.Provider value={current}>
      <SelectPrimitive.Root
        {...props}
        {...(controlled !== undefined ? { value: controlled } : { defaultValue })}
        onValueChange={(next) => {
          setInner(next);
          onValueChange?.(next);
        }}
      />
    </SelectValueContext.Provider>
  );
}

const SelectGroup = SelectPrimitive.Group;

const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-3 py-2 text-xs shadow-xs transition-colors placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 dark:border-zinc-800 dark:bg-zinc-900/50",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="size-3.5 opacity-50 shrink-0 transition-transform duration-200" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronUp className="size-3.5" />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronDown className="size-3.5" />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

const isItem = (element: React.ReactElement) => element.type === SelectItem;
const isGroup = (element: React.ReactElement) => element.type === SelectGroup;

/**
 * The list body. It holds the search text itself, so it starts empty every
 * time the list opens: Radix mounts a fresh copy on each open.
 */
function SelectBody({
  children,
  position,
  searchPlaceholder,
  searchThreshold,
}: {
  children: React.ReactNode;
  position: "popper" | "item-aligned";
  searchPlaceholder: string;
  searchThreshold: number;
}) {
  const selected = React.useContext(SelectValueContext);
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const searchable = countItems(children, { isItem, isGroup }) > searchThreshold;
  const filtered = searchable && query.trim() ? filterOptions(children, query, { isItem, isGroup }, selected) : null;

  React.useEffect(() => {
    if (!searchable) return;
    // Radix focuses the chosen option as it opens; typing should start in the box instead.
    const frame = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [searchable]);

  return (
    <SearchableContext.Provider value={searchable}>
      {searchable && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            role="searchbox"
            aria-label="Search options"
            autoComplete="off"
            spellCheck={false}
            value={query}
            placeholder={searchPlaceholder}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // Enter picks the first match, so search-and-confirm needs no mouse.
                e.preventDefault();
                e.stopPropagation();
                listRef.current?.querySelector<HTMLElement>('[role="option"]:not([data-disabled])')?.click();
                return;
              }
              // Arrows hand focus to the options and Escape closes the list; every other key is
              // for the box, and Radix would otherwise treat it as type-to-select.
              if (!["ArrowDown", "ArrowUp", "Escape", "Tab"].includes(e.key)) e.stopPropagation();
            }}
            className="h-6 w-full min-w-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>
      )}
      <SelectPrimitive.Viewport
        ref={listRef}
        className={cn(
          "p-1",
          position === "popper" &&
            "h-(--radix-select-trigger-height) w-full min-w-(--radix-select-trigger-width)",
        )}
      >
        {filtered ? filtered.nodes : children}
        {filtered && filtered.matches === 0 && (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">No matches</p>
        )}
      </SelectPrimitive.Viewport>
    </SearchableContext.Provider>
  );
}

const SelectContent = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content> & {
    /** Show a search box when there are more options than this. */
    searchThreshold?: number;
    searchPlaceholder?: string;
  }
>(
  (
    { className, children, position = "popper", searchThreshold = SEARCH_THRESHOLD, searchPlaceholder = "Search…", ...props },
    ref,
  ) => (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        className={cn(
          "relative z-50 max-h-80 min-w-32 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 dark:border-zinc-800 dark:bg-zinc-900",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className,
        )}
        position={position}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectBody position={position} searchPlaceholder={searchPlaceholder} searchThreshold={searchThreshold}>
          {children}
        </SelectBody>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  ),
);
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-xs font-semibold text-muted-foreground", className)}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, onPointerMove, ...props }, ref) => {
  const searchable = React.useContext(SearchableContext);
  return (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-pointer select-none items-center rounded-lg py-1.5 pl-2 pr-8 text-xs outline-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 transition-colors",
      searchable && "hover:bg-accent hover:text-accent-foreground",
      className,
    )}
    onPointerMove={(event) => {
      // Radix focuses an option as the pointer moves over it, which would pull the caret out of the search box.
      if (searchable) event.preventDefault();
      onPointerMove?.(event);
    }}
    {...props}
  >
    <span className="absolute right-2 flex size-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="size-3.5 text-primary" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
  );
});
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
};
