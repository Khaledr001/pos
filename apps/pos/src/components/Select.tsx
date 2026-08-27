import { Check, ChevronDown } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  subLabel?: string;
  icon?: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
}

export interface SelectProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg";
  "aria-label"?: string;
  id?: string;
}

/**
 * Custom POS Select Component.
 *
 * Touch & keyboard-friendly select dropdown built with POS design system tokens.
 * Features:
 * - Clean Light & Dark theme support
 * - Touch-optimized hit targets
 * - Checkmark indicator on active item
 * - Keyboard navigation (Esc, Enter, Arrows)
 * - Click-outside dismiss
 */
export function Select<T extends string = string>({
  value,
  onChange,
  options,
  placeholder = "Select option...",
  disabled = false,
  className = "",
  size = "md",
  "aria-label": ariaLabel,
  id,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // Keyboard navigation
  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;

    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const sizeClasses = {
    sm: "h-7 px-2 text-[10px] rounded-md gap-1",
    md: "h-9 px-3 text-xs rounded-xl gap-2",
    lg: "h-11 px-3.5 text-sm rounded-xl gap-2.5",
  }[size];

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      {/* Trigger Button */}
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel ?? placeholder}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        className={[
          "flex w-full items-center justify-between border bg-(--pos-raised) text-(--pos-text) transition-all select-none cursor-pointer",
          sizeClasses,
          disabled
            ? "cursor-not-allowed opacity-50 border-(--pos-border)/50"
            : open
              ? "border-(--pos-accent) ring-1 ring-(--pos-accent)/20 shadow-xs"
              : "border-(--pos-border) hover:bg-(--pos-hover) hover:border-(--pos-accent)/40",
        ].join(" ")}
      >
        <span className="flex items-center gap-1.5 truncate">
          {selectedOption?.icon && (
            <selectedOption.icon className="size-3.5 shrink-0 text-(--pos-accent)" />
          )}
          <span className={selectedOption ? "font-semibold truncate" : "text-(--pos-text-3)"}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </span>

        <ChevronDown
          className={[
            "size-3 shrink-0 text-(--pos-text-3) transition-transform duration-200",
            open ? "rotate-180 text-(--pos-accent)" : "",
          ].join(" ")}
        />
      </button>

      {/* Dropdown Menu */}
      {open && (
        <div
          role="listbox"
          className="absolute z-50 mt-1 min-w-48 w-full max-h-56 overflow-y-auto rounded-xl border border-(--pos-border) bg-(--pos-panel) p-1 shadow-lg backdrop-blur-md animate-line-in scrollbar-thin"
        >
          {options.length === 0 ? (
            <div className="p-3 text-center text-xs text-(--pos-text-3)">No options available</div>
          ) : (
            options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={opt.disabled}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={[
                    "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer select-none",
                    opt.disabled
                      ? "cursor-not-allowed opacity-40 text-(--pos-text-3)"
                      : isSelected
                        ? "bg-(--pos-accent)/15 text-(--pos-accent) font-bold"
                        : "text-(--pos-text) hover:bg-(--pos-raised) hover:text-(--pos-text)",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {opt.icon && (
                      <opt.icon
                        className={`size-3.5 shrink-0 ${
                          isSelected ? "text-(--pos-accent)" : "text-(--pos-text-3)"
                        }`}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <span className="block truncate">{opt.label}</span>
                      {opt.subLabel && (
                        <span className="block text-[10px] text-(--pos-text-3) truncate font-normal">
                          {opt.subLabel}
                        </span>
                      )}
                    </div>
                  </div>

                  {isSelected && <Check className="size-3.5 shrink-0 text-(--pos-accent) ml-2" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
