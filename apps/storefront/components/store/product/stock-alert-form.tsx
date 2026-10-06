"use client";

import { stockAlertsApi } from "@devsfleet/storefront-client";
import { BellRing, CheckCircle2 } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormError, TextField } from "@/components/ui/field";
import { api } from "@/lib/api-browser";
import { useMe } from "@/lib/hooks/store";
import { friendlyError } from "@/components/store/account/session";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * "Tell me when it's back" for a sold-out option. Works for guests: the
 * address is all the API needs, and it answers the same way whether or not
 * the address was already on the list.
 *
 * The caller keys this by variant, so choosing another option starts a fresh
 * form instead of carrying a "you're on the list" message to the wrong item.
 */
export function StockAlertForm({ variantId, productName }: { variantId: string; productName: string }) {
  const { data: me } = useMe();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const headingId = useId();

  // A signed-in shopper's address and number are filled in until they type their own.
  const emailValue = email || me?.email || "";
  const phoneValue = phone || me?.phone || "";
  const emailError = touched && !EMAIL.test(emailValue.trim()) ? "Enter a valid email address, like name@company.com" : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!EMAIL.test(emailValue.trim())) return;
    setPending(true);
    try {
      await stockAlertsApi(api).subscribe({
        variantId,
        email: emailValue.trim(),
        ...(phoneValue.trim() ? { phone: phoneValue.trim() } : {}),
        website,
      });
      setDone(true);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setPending(false);
    }
  };

  if (done) {
    return (
      <p role="status" className="mt-4 flex items-start gap-2 rounded-[var(--radius-tag)] bg-pipe-tint px-3 py-2 text-[15px] text-pipe-dark">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
        <span>
          You&apos;re on the waiting list for {productName}. We&apos;ll let you know when it&apos;s back in stock.
        </span>
      </p>
    );
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby={headingId} className="mt-4 space-y-3 border-t border-galv pt-4">
      <h3 id={headingId} className="flex items-center gap-2 text-lg font-semibold">
        <BellRing className="size-5 text-steel" aria-hidden /> Notify me when it&apos;s back in stock
      </h3>
      <TextField
        label="Email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        maxLength={255}
        value={emailValue}
        onChange={(e) => setEmail(e.target.value)}
        onBlur={() => setTouched(true)}
        error={emailError}
      />
      <TextField
        label="WhatsApp or phone (optional)"
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        placeholder="+971 50 123 4567"
        maxLength={20}
        value={phoneValue}
        onChange={(e) => setPhone(e.target.value)}
        hint="A UAE number"
      />
      {/* Honeypot: invisible and unreachable for people, tempting for form-filling scripts. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Leave this field empty
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>
      <div aria-live="polite">
        <FormError message={error} />
      </div>
      <Button type="submit" variant="secondary" loading={pending} className="w-full sm:w-auto">
        Notify me
      </Button>
    </form>
  );
}
