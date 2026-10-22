"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { DateRangePicker } from "@/components/ui/date-range-picker";

/**
 * The period filter on a list page. The dates live in the page's URL filters,
 * so a period can be bookmarked or sent to the accountant as a link, and the
 * export downloads exactly the period on screen.
 *
 * A thin wrapper over the shared picker that keeps the from/to props the list
 * pages already pass.
 */
export function DateRangeFilter({
  from,
  to,
  onChange,
  label = "Period",
  align,
  className,
}: {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  label?: string;
  align?: "start" | "end";
  className?: string;
}) {
  return (
    <DateRangePicker
      value={{ from, to }}
      onChange={onChange}
      label={label}
      align={align}
      className={cn("w-full sm:w-64", className)}
    />
  );
}
