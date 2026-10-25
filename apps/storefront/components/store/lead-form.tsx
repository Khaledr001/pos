"use client";

import type { LeadSource } from "@devsfleet/shared-types";
import { formsApi, type FormField, type PublicForm } from "@devsfleet/storefront-client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormError, inputClass, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { api, errorMessage } from "@/lib/api-browser";
import { cn } from "@/lib/cn";

type Values = Record<string, string | boolean>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[\d\s().-]{6,20}$/;

/** What is wrong with one answer, or null. The API checks again; this just saves a round trip. */
function problem(field: FormField, value: string | boolean | undefined): string | null {
  if (field.type === "checkbox") return field.required && value !== true ? "Please tick this box to continue." : null;
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return field.required ? `${field.label} is required.` : null;
  if (field.type === "email" && !EMAIL.test(text)) return "Enter a valid email address.";
  if (field.type === "phone" && !PHONE.test(text)) return "Enter a valid phone number.";
  if (field.type === "number" && !Number.isFinite(Number(text))) return "Enter a number.";
  if (field.type === "select" && !(field.options ?? []).includes(text)) return "Choose one of the options.";
  return null;
}

const AUTOCOMPLETE = { name: "name", email: "email", phone: "tel" } as const;

function FieldInput({
  field,
  value,
  error,
  onChange,
}: {
  field: FormField;
  value: string | boolean | undefined;
  error: string | undefined;
  onChange: (value: string | boolean) => void;
}) {
  const common = {
    name: field.key,
    required: field.required,
    "aria-required": field.required || undefined,
    autoComplete: field.role ? AUTOCOMPLETE[field.role] : undefined,
  };
  const checkId = useId();
  const label = field.label;
  const hint = field.helpText;
  const text = typeof value === "string" ? value : "";

  switch (field.type) {
    case "textarea":
      return <TextAreaField {...common} label={label} hint={hint} error={error} rows={4} placeholder={field.placeholder} value={text} onChange={(e) => onChange(e.target.value)} className="sm:col-span-2" />;
    case "select":
      return (
        <SelectField {...common} label={label} hint={hint} error={error} value={text} onChange={(e) => onChange(e.target.value)}>
          <option value="">{field.placeholder ?? "Select…"}</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </SelectField>
      );
    case "checkbox": {
      const describedBy = error ? `${checkId}-error` : hint ? `${checkId}-hint` : undefined;
      return (
        <div className="sm:col-span-2">
          <label htmlFor={checkId} className="flex cursor-pointer items-start gap-2.5 text-[15px]">
            <input
              id={checkId}
              type="checkbox"
              name={field.key}
              aria-describedby={describedBy}
              aria-invalid={!!error || undefined}
              aria-required={field.required || undefined}
              checked={value === true}
              onChange={(e) => onChange(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[var(--color-pipe)]"
            />
            <span>
              {label}
              {field.required && <span aria-hidden> *</span>}
            </span>
          </label>
          {error ? (
            <p id={`${checkId}-error`} role="alert" className="mt-1.5 text-sm text-signal">
              {error}
            </p>
          ) : hint ? (
            <p id={`${checkId}-hint`} className="mt-1.5 text-sm text-steel">
              {hint}
            </p>
          ) : null}
        </div>
      );
    }
    default: {
      const type = field.type === "phone" ? "tel" : field.type;
      return (
        <TextField
          {...common}
          type={type}
          inputMode={field.type === "number" ? "decimal" : undefined}
          label={field.required ? `${label} *` : label}
          hint={hint}
          error={error}
          placeholder={field.placeholder}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
  }
}

/**
 * A form from the form builder, rendered from its definition. Spam defences
 * travel with the submission: a hidden `website` field a person never sees, and
 * the time it was first shown, so a bot that fills everything instantly is
 * recognised by the API. Nothing else about a lead is decided in the browser.
 */
export function LeadForm({
  form,
  source,
  compact,
  initialValues,
  onSuccess,
  className,
}: {
  form: PublicForm;
  source?: LeadSource;
  /** Starting answers by field key, e.g. a product enquiry's message. Keys the form does not have are ignored. */
  initialValues?: Record<string, string>;
  /** One column, for a dialog. */
  compact?: boolean;
  onSuccess?: () => void;
  className?: string;
}) {
  const [values, setValues] = useState<Values>(() =>
    Object.fromEntries(form.fields.map((f) => [f.key, f.type === "checkbox" ? false : f.type === "select" ? "" : (initialValues?.[f.key] ?? "")])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [website, setWebsite] = useState("");
  const [pending, setPending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const startedAt = useRef(0);
  const doneRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    startedAt.current = Date.now();
  }, []);
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    const found: Record<string, string> = {};
    for (const field of form.fields) {
      const message = problem(field, values[field.key]);
      if (message) found[field.key] = message;
    }
    setErrors(found);
    const firstBad = form.fields.find((f) => found[f.key]);
    if (firstBad) {
      formRef.current?.querySelector<HTMLElement>(`[name="${firstBad.key}"]`)?.focus();
      return;
    }

    const answers: Record<string, string | number | boolean> = {};
    for (const field of form.fields) {
      const value = values[field.key];
      if (field.type === "checkbox") answers[field.key] = value === true;
      else if (typeof value === "string" && value.trim()) answers[field.key] = field.type === "number" ? Number(value) : value.trim();
    }

    setPending(true);
    try {
      // Where it came from: the page it was sent from, unless the caller (a product enquiry) says more.
      const origin: LeadSource = { ...source, path: source?.path ?? window.location.pathname };
      const result = await formsApi(api).submit(form.slug, { values: answers, source: origin, website, startedAt: startedAt.current });
      setDone(form.successMessage || result.message);
      onSuccess?.();
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div ref={doneRef} tabIndex={-1} role="status" className={cn("rounded-[var(--radius-panel)] bg-pipe-tint p-5 text-pipe-dark outline-none", className)}>
        <p className="font-cond text-xl font-semibold">Thank you</p>
        <p className="mt-1 text-[15px]">{done}</p>
      </div>
    );
  }

  const failed = Object.keys(errors).length;
  return (
    <form ref={formRef} onSubmit={submit} noValidate className={cn("relative", className)} aria-label={form.name}>
      <fieldset disabled={pending} className="min-w-0 border-0 p-0">
        <div className={cn("grid gap-4", !compact && "sm:grid-cols-2")}>
          {form.fields.map((field) => (
            <FieldInput key={field.key} field={field} value={values[field.key]} error={errors[field.key]} onChange={(v) => setValues((s) => ({ ...s, [field.key]: v }))} />
          ))}
        </div>

        {/* Honeypot: invisible and unreachable to people and screen readers; a bot that fills every input trips it. */}
        <div aria-hidden="true" className="absolute -left-[9999px] top-0 h-0 w-0 overflow-hidden">
          <label>
            Website
            <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} className={inputClass} />
          </label>
        </div>

        {failed > 0 && <p className="mt-4 text-sm text-signal">{failed === 1 ? "Please fix the highlighted field." : `Please fix the ${failed} highlighted fields.`}</p>}
        <FormError message={serverError} />
        <Button type="submit" size="lg" className="mt-5 w-full sm:w-auto" loading={pending}>
          {form.submitLabel || "Send"}
        </Button>
      </fieldset>
    </form>
  );
}
