"use client";

import React from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "../shared";
import { IMAGE_URL } from "./section-meta";

/**
 * A repeating group of fields (badges, cards, FAQ entries…): add, remove and
 * reorder with plain buttons. The caller says how one row looks; this owns the
 * mechanics and the cap.
 */
export function ItemListEditor<T>({
  noun,
  items,
  onChange,
  max,
  blank,
  renderItem,
  disabled,
}: {
  /** "card", "badge": used in button labels, so a screen reader hears which row. */
  noun: string;
  items: T[];
  onChange: (next: T[]) => void;
  max: number;
  blank: () => T;
  renderItem: (item: T, update: (patch: Partial<T>) => void, index: number) => React.ReactNode;
  disabled?: boolean;
}) {
  const move = (i: number, by: -1 | 1) => {
    const next = [...items];
    const [it] = next.splice(i, 1);
    next.splice(i + by, 0, it!);
    onChange(next);
  };
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={i} className="flex gap-2 rounded-lg border border-border p-3">
          <div className="min-w-0 flex-1">{renderItem(item, (patch) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x))), i)}</div>
          {!disabled && (
            <div className="flex shrink-0 flex-col items-center gap-0.5">
              <Button type="button" size="icon" variant="ghost" aria-label={`Move ${noun} ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}><ChevronUp className="h-4 w-4" /></Button>
              <Button type="button" size="icon" variant="ghost" aria-label={`Move ${noun} ${i + 1} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)}><ChevronDown className="h-4 w-4" /></Button>
              <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${noun} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          )}
        </div>
      ))}
      {items.length === 0 && <p className="rounded-lg border border-dashed p-3 text-center text-[11px] text-muted-foreground">No {noun}s yet.</p>}
      {!disabled && (
        <div className="flex items-center gap-3">
          <Button type="button" size="sm" variant="outline" disabled={items.length >= max} onClick={() => onChange([...items, blank()])}><Plus className="h-4 w-4" /> Add {noun}</Button>
          <span className="text-[11px] text-muted-foreground">{items.length} of {max}</span>
        </div>
      )}
    </div>
  );
}

/**
 * An image is an address for now: the admin has no general upload. The
 * thumbnail shows straight away so a wrong address is obvious before saving.
 */
export function ImageUrlField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  hint?: string;
}) {
  const v = value ?? "";
  const valid = !v || IMAGE_URL.test(v);
  const [broken, setBroken] = React.useState(false);
  React.useEffect(() => setBroken(false), [v]);
  return (
    <Field label={label} hint={hint ?? "An https:// address, or a path starting with /."}>
      <div className="flex items-center gap-2">
        {v && valid && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v} alt="" className="h-9 w-12 shrink-0 rounded-md border border-border object-cover" onError={() => setBroken(true)} />
        ) : (
          <span aria-hidden="true" className="h-9 w-12 shrink-0 rounded-md border border-dashed border-border bg-muted/40" />
        )}
        <Input inputMode="url" aria-label={label} aria-invalid={!valid} placeholder="https://…" value={v} onChange={(e) => onChange(e.target.value)} />
      </div>
      {broken && v && valid && <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">That address did not load as a picture.</p>}
    </Field>
  );
}
