"use client";

import type { TradeStatus } from "@al-lahiq/api-client";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { FormError, TextAreaField, TextField } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api-browser";
import { useMe } from "@/lib/hooks/store";
import { QueryError, friendlyError } from "./session";

export function TradeApplicationForm({ companyName, trn }: { companyName: string; trn: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ companyName, trn, message: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const cleanTrn = form.trn.replace(/[\s-]/g, "");
  const trnError = cleanTrn.length >= 15 && !/^100\d{12}$/.test(cleanTrn) ? "A UAE TRN is 15 digits and starts with 100" : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^100\d{12}$/.test(cleanTrn)) {
      setError("Enter your 15-digit TRN, starting with 100. You'll find it on your VAT registration certificate.");
      return;
    }
    setPending(true);
    try {
      await api.post<{ tradeStatus: TradeStatus }>("/me/trade-application", {
        companyName: form.companyName.trim(),
        trn: cleanTrn,
        ...(form.message.trim() ? { message: form.message.trim() } : {}),
      });
      await qc.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      setError(err instanceof ApiError && err.code === "ALREADY_TRADE" ? "Your trade account is already active." : friendlyError(err));
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Company name"
          autoComplete="organization"
          value={form.companyName}
          onChange={(e) => setForm({ ...form, companyName: e.target.value })}
          required
          minLength={2}
          maxLength={200}
          hint="As it appears on your trade licence"
        />
        <TextField
          label="TRN"
          inputMode="numeric"
          placeholder="100XXXXXXXXXXXX"
          value={form.trn}
          onChange={(e) => setForm({ ...form, trn: e.target.value })}
          required
          hint="15 digits, starting with 100"
          error={trnError}
        />
      </div>
      <TextAreaField
        label="About your business (optional)"
        rows={3}
        maxLength={1000}
        value={form.message}
        onChange={(e) => setForm({ ...form, message: e.target.value })}
        hint="For example the kind of projects you work on and what you buy most"
      />
      <div aria-live="polite">
        <FormError message={error} />
      </div>
      <Button type="submit" loading={pending} disabled={form.companyName.trim().length < 2 || !form.trn}>
        Send application
      </Button>
    </form>
  );
}

function StatusPanel({ tone, icon, title, children }: { tone: "pipe" | "brass" | "signal" | "plain"; icon?: ReactNode; title: string; children: ReactNode }) {
  const tones = {
    pipe: "border-pipe/30 bg-pipe-tint",
    brass: "border-brass/40 bg-brass-tint",
    signal: "border-signal/30 bg-signal-tint",
    plain: "border-galv bg-paper",
  };
  return (
    <section aria-labelledby="trade-status" className={`rounded-[var(--radius-panel)] border p-5 sm:p-6 ${tones[tone]}`}>
      <h2 id="trade-status" className="flex items-center gap-2 text-2xl">
        {icon}
        {title}
      </h2>
      <div className="mt-2 space-y-4 text-[15px]">{children}</div>
    </section>
  );
}

/** The visitor's trade status, or the sign-up prompt / application form. */
export function TradeStatusPanel() {
  const { data: me, isLoading, error } = useMe();
  const next = encodeURIComponent("/account/trade");
  if (isLoading) return <div role="status" className="h-40 animate-pulse rounded-[var(--radius-panel)] border border-galv bg-paper"><span className="sr-only">Loading your trade status</span></div>;
  if (error) return <QueryError error={error} />;
  return (
    <>
      {!me && (
        <StatusPanel tone="plain" title="Create an account to apply">
          <p className="text-steel">
            It takes a minute. Then send us your company name and TRN, and we&apos;ll review your application.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <ButtonLink href={`/register?next=${next}`}>Create an account</ButtonLink>
            <span className="text-steel">
              Already have one?{" "}
              <Link href={`/login?next=${next}`} className="font-semibold text-pipe hover:underline">
                Log in to apply
              </Link>
            </span>
          </div>
        </StatusPanel>
      )}

      {me?.tradeStatus === "APPROVED" && (
        <StatusPanel tone="pipe" icon={<CheckCircle2 className="size-6 text-pipe" aria-hidden />} title="Your trade account is active">
          <p>
            You see your trade prices across the store whenever you&apos;re logged in
            {me.companyName ? `, and invoices go to ${me.companyName}` : ""}
            {me.trn ? ` (TRN ${me.trn})` : ""}.
          </p>
          <p className="text-steel">
            Need a quote for a large project? Send us your list on WhatsApp or{" "}
            <Link href="/contact" className="text-pipe underline">
              contact us
            </Link>
            .
          </p>
        </StatusPanel>
      )}

      {me?.tradeStatus === "PENDING" && (
        <StatusPanel tone="brass" icon={<Clock className="size-6 text-[#7a5a0c]" aria-hidden />} title="We're reviewing your trade application">
          <p>
            We&apos;ll email {me.email} when your trade prices are ready. Until then you can keep ordering at our regular prices.
          </p>
          {(me.companyName || me.trn) && (
            <p className="text-steel">
              Applied as {me.companyName}
              {me.trn ? `, TRN ${me.trn}` : ""}.
            </p>
          )}
        </StatusPanel>
      )}

      {me?.tradeStatus === "REJECTED" && (
        <StatusPanel tone="signal" icon={<XCircle className="size-6 text-signal" aria-hidden />} title="We couldn't approve your application">
          <p>
            Check your company name and TRN and apply again below, or{" "}
            <Link href="/contact" className="underline">
              contact us
            </Link>{" "}
            to talk it through.
          </p>
        </StatusPanel>
      )}

      {me && (me.tradeStatus === "NONE" || me.tradeStatus === "REJECTED") && (
        <section aria-labelledby="apply" className="rounded-[var(--radius-panel)] border border-galv bg-paper p-5 sm:p-6">
          <h2 id="apply" className="text-2xl">
            Apply for a trade account
          </h2>
          <p className="mt-1 mb-5 text-[15px] text-steel">We check your details and set up your prices, then email you.</p>
          <TradeApplicationForm companyName={me.companyName ?? ""} trn={me.trn ?? ""} />
        </section>
      )}
    </>
  );
}
