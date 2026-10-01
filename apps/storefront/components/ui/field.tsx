import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export const inputClass =
  "w-full h-11 rounded-[var(--radius-tag)] border border-galv bg-paper px-3 text-[15px] text-ink placeholder:text-steel-light focus:border-pipe focus:outline-none focus:ring-2 focus:ring-pipe/20 aria-[invalid=true]:border-signal";

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (id: string, describedBy: string | undefined) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children(id, describedBy)}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-signal">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-steel">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextField({
  label,
  hint,
  error,
  className,
  ...props
}: ComponentProps<"input"> & { label: string; hint?: ReactNode; error?: string | null }) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id, describedBy) => (
        <input id={id} aria-describedby={describedBy} aria-invalid={!!error || undefined} className={inputClass} {...props} />
      )}
    </Field>
  );
}

export function SelectField({
  label,
  hint,
  error,
  className,
  children,
  ...props
}: ComponentProps<"select"> & { label: string; hint?: ReactNode; error?: string | null }) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id, describedBy) => (
        <select id={id} aria-describedby={describedBy} aria-invalid={!!error || undefined} className={inputClass} {...props}>
          {children}
        </select>
      )}
    </Field>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  className,
  ...props
}: ComponentProps<"textarea"> & { label: string; hint?: ReactNode; error?: string | null }) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id, describedBy) => (
        <textarea
          id={id}
          aria-describedby={describedBy}
          aria-invalid={!!error || undefined}
          className={cn(inputClass, "h-auto min-h-24 py-2")}
          {...props}
        />
      )}
    </Field>
  );
}

export function Checkbox({ label, className, ...props }: ComponentProps<"input"> & { label: ReactNode }) {
  return (
    <label className={cn("inline-flex items-center gap-2 text-[15px] cursor-pointer select-none", className)}>
      <input type="checkbox" className="size-4 accent-[var(--color-pipe)]" {...props} />
      {label}
    </label>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-[var(--radius-tag)] border border-signal/30 bg-signal-tint px-3 py-2 text-sm text-signal">
      {message}
    </div>
  );
}
