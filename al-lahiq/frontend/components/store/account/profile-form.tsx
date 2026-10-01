"use client";

import type { Customer } from "@al-lahiq/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormError, TextField } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api-browser";
import { useMe } from "@/lib/hooks/store";
import { QueryError, friendlyError } from "./session";

/** Loads the customer, then shows the form with their details. */
export function ProfileSection() {
  const { data: me, isLoading, error } = useMe();
  if (isLoading) return <p className="text-steel">Loading your details…</p>;
  if (error) return <QueryError error={error} />;
  if (!me) return <QueryError error={new ApiError(401, { code: "UNAUTHORIZED" })} />;
  return <ProfileForm key={me.id} me={me} />;
}

export function ProfileForm({ me }: { me: Customer }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    firstName: me.firstName,
    lastName: me.lastName,
    phone: me.phone ?? "",
    companyName: me.companyName ?? "",
    trn: me.trn ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setSaved(false);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };
  const trn = form.trn.replace(/[\s-]/g, "");
  const trnError = trn && trn.length >= 15 && !/^100\d{12}$/.test(trn) ? "A UAE TRN is 15 digits and starts with 100" : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (trn && !/^100\d{12}$/.test(trn)) {
      setError("Enter your 15-digit TRN, starting with 100, or leave it empty.");
      return;
    }
    const phone = form.phone.replace(/[\s-]/g, "");
    setPending(true);
    try {
      // Empty optional fields are sent as null, which clears them.
      const updated = await api.patch<Customer>("/me/profile", {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        phone: phone || null,
        companyName: form.companyName.trim() || null,
        trn: trn || null,
      });
      qc.setQueryData(["me"], updated);
      setSaved(true);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 font-cond text-2xl font-semibold">Your details</legend>
        <TextField label="First name" autoComplete="given-name" value={form.firstName} onChange={set("firstName")} required maxLength={60} />
        <TextField label="Last name" autoComplete="family-name" value={form.lastName} onChange={set("lastName")} required maxLength={60} />
        <TextField label="Email" type="email" value={me.email} readOnly disabled hint="To change your email, contact us" />
        <TextField
          label="Mobile"
          type="tel"
          autoComplete="tel"
          placeholder="+971 50 123 4567"
          value={form.phone}
          onChange={set("phone")}
          hint="A UAE mobile number, for delivery and order updates"
        />
      </fieldset>
      <div className="border-t border-galv pt-5">
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-1 font-cond text-2xl font-semibold">Company</legend>
        <p className="text-[15px] text-steel sm:col-span-2">Used on your tax invoices. You can still change them for a single order at checkout.</p>
        <TextField label="Company name" autoComplete="organization" value={form.companyName} onChange={set("companyName")} maxLength={200} />
        <TextField label="TRN" inputMode="numeric" placeholder="100XXXXXXXXXXXX" value={form.trn} onChange={set("trn")} hint="15 digits, starting with 100" error={trnError} />
      </fieldset>
      </div>
      <div aria-live="polite">
        <FormError message={error} />
        {saved && <p className="rounded-[var(--radius-tag)] bg-pipe-tint px-3 py-2 text-sm text-pipe-dark">Your details are saved.</p>}
      </div>
      <Button type="submit" loading={pending} disabled={!form.firstName.trim() || !form.lastName.trim()}>
        Save changes
      </Button>
    </form>
  );
}
