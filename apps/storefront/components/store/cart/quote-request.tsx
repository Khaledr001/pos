"use client";

import { quotesApi, type QuoteView } from "@devsfleet/storefront-client";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileText, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { friendlyError } from "@/components/store/account/session";
import { Button, ButtonLink } from "@/components/ui/button";
import { FormError, TextAreaField, TextField } from "@/components/ui/field";
import { api } from "@/lib/api-browser";
import { useMe } from "@/lib/hooks/store";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Fields = { company: string; name: string; email: string; phone: string; notes: string };

/**
 * "Request a quote" on the cart page: the cart's lines go to staff to price.
 * Needs a signed-in shopper (the quote lives in their account); a guest gets a
 * login link that returns here. The form never sends prices.
 */
export function QuoteRequest({ itemCount }: { itemCount: number }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  // One id per submission attempt, so a double click or a retry is one quote.
  const clientId = useRef<string>(crypto.randomUUID());
  const [edited, setEdited] = useState<Partial<Fields>>({});
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [quote, setQuote] = useState<QuoteView | null>(null);

  const profile: Fields = {
    company: me?.companyName ?? "",
    name: me ? `${me.firstName} ${me.lastName}`.trim() : "",
    email: me?.email ?? "",
    phone: me?.phone ?? "",
    notes: "",
  };
  const value = (key: keyof Fields) => edited[key] ?? profile[key];
  const set = (key: keyof Fields) => (e: { target: { value: string } }) => setEdited((f) => ({ ...f, [key]: e.target.value }));

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    // Esc and the backdrop close it natively; keep React's picture in step.
    const onClose = () => setError(null);
    el.addEventListener("close", onClose);
    return () => el.removeEventListener("close", onClose);
  }, []);

  if (!me) {
    return (
      <p className="text-sm text-steel">
        Buying for a business?{" "}
        <Link href="/login?next=%2Fcart" className="font-semibold text-pipe underline">
          Log in to request a quote
        </Link>
        .
      </p>
    );
  }

  const open = () => {
    setQuote(null);
    setErrors({});
    setError(null);
    dialog.current?.showModal();
  };
  const close = () => dialog.current?.close();

  const validate = () => {
    const next: Partial<Record<keyof Fields, string>> = {};
    if (value("name").trim().length < 2) next.name = "Enter the contact's full name";
    if (!EMAIL.test(value("email").trim())) next.email = "Enter a valid email address";
    if (value("phone").trim().length < 8) next.phone = "Enter a phone number we can reach you on";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!validate()) return;
    setPending(true);
    try {
      const created = await quotesApi(api).create({
        clientId: clientId.current,
        contact: { fullName: value("name").trim(), email: value("email").trim(), phone: value("phone").trim() },
        ...(value("company").trim() ? { companyName: value("company").trim() } : {}),
        ...(value("notes").trim() ? { notes: value("notes").trim() } : {}),
      });
      setQuote(created);
      clientId.current = crypto.randomUUID();
      void qc.invalidateQueries({ queryKey: ["quotes"] });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Button type="button" variant="secondary" size="lg" className="w-full" onClick={open}>
        <FileText className="size-4" aria-hidden /> Request a quote
      </Button>
      <p className="text-sm text-steel">Ordering in bulk? We&apos;ll price your {itemCount === 1 ? "item" : "cart"} and send you a quote.</p>

      <dialog
        ref={dialog}
        aria-labelledby="quote-title"
        className="m-auto w-[min(92vw,34rem)] rounded-[var(--radius-panel)] border border-galv bg-paper p-0 text-ink backdrop:bg-ink/50"
      >
        <div className="flex items-start justify-between gap-4 border-b border-galv px-5 py-4">
          <h2 id="quote-title" className="text-2xl">
            {quote ? "Quote requested" : "Request a quote"}
          </h2>
          <button type="button" onClick={close} aria-label="Close" className="rounded p-1 text-steel hover:text-ink">
            <X className="size-5" aria-hidden />
          </button>
        </div>

        {quote ? (
          <div className="space-y-4 px-5 py-5" role="status">
            <p className="flex items-start gap-2 text-[15px]">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-pipe" aria-hidden />
              <span>
                We&apos;ve received your request, <strong className="font-cond text-lg">{quote.number}</strong>. Our team will price it and the quote will
                appear under <em>Quotes</em> in your account. Your cart is unchanged.
              </span>
            </p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href={`/account/quotes/${quote.id}`}>View your quote</ButtonLink>
              <Button type="button" variant="secondary" onClick={close}>
                Back to cart
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-4 px-5 py-5">
            <p className="text-[15px] text-steel">
              We&apos;ll price the {itemCount} {itemCount === 1 ? "item" : "items"} in your cart. Prices on a quote are confirmed by our team.
            </p>
            <TextField label="Company (optional)" autoComplete="organization" maxLength={200} value={value("company")} onChange={set("company")} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Contact name" autoComplete="name" required value={value("name")} onChange={set("name")} error={errors.name} />
              <TextField label="Phone" type="tel" autoComplete="tel" inputMode="tel" required placeholder="+971 50 123 4567" value={value("phone")} onChange={set("phone")} error={errors.phone} />
            </div>
            <TextField label="Email" type="email" autoComplete="email" required value={value("email")} onChange={set("email")} error={errors.email} />
            <TextAreaField
              label="Notes (optional)"
              rows={3}
              maxLength={2000}
              value={value("notes")}
              onChange={set("notes")}
              hint="Delivery site, deadline, substitutions you'd accept"
            />
            <div aria-live="polite">
              <FormError message={error} />
            </div>
            <div className="flex flex-wrap justify-end gap-3">
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" loading={pending}>
                Send request
              </Button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
