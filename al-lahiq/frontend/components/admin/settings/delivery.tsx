"use client";

import type { Emirate, ShippingRate } from "@al-lahiq/api-client";
import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, FormError, TextField } from "@/components/ui/field";
import { adminApi, errorMessage } from "@/lib/api-browser";
import { EMIRATES } from "@/lib/format";
import { useAdminQuery, useInvalidate } from "../data";
import { filsToInput, formatAed, inputToFils, withVat } from "../helpers";
import { useUnsavedWarning } from "../row-controls";
import { useToast } from "../toast";
import { ErrorState, Loading, PageHeader, Panel } from "../ui";
import { SettingsTabs } from "./general";

export function DeliverySettings() {
  const { data, error, isPending, refetch } = useAdminQuery<ShippingRate[]>("/admin/shipping-rates");
  return (
    <>
      <PageHeader
        title="Delivery rates"
        description="Courier fees per emirate. Enter amounts before VAT; shoppers see them with 5% VAT added."
      />
      <SettingsTabs />
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isPending ? (
        <Loading label="Loading delivery rates" />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {EMIRATES.map((e) => (
            <RateCard key={e.value} emirate={e.value} label={e.label} rate={data.find((r) => r.emirate === e.value) ?? null} />
          ))}
        </div>
      )}
    </>
  );
}

type Fields = { base: string; baseKg: string; perKg: string; freeOver: string; maxKg: string; eta: string; active: boolean };

const fieldsFrom = (r: ShippingRate | null): Fields => ({
  base: r ? filsToInput(r.baseFils) : "",
  baseKg: r ? String(r.baseWeightKg) : "5",
  perKg: r ? filsToInput(r.perKgFils) : "0.00",
  freeOver: r?.freeOverFils != null ? filsToInput(r.freeOverFils) : "",
  maxKg: r ? String(r.maxWeightKg) : "30",
  eta: r ? String(r.etaDays) : "2",
  active: r?.active ?? false,
});

function RateCard({ emirate, label, rate }: { emirate: Emirate; label: string; rate: ShippingRate | null }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [f, setF] = useState<Fields>(() => fieldsFrom(rate));
  const [saved, setSaved] = useState(() => JSON.stringify(fieldsFrom(rate)));
  const [problem, setProblem] = useState<string | null>(null);
  const dirty = JSON.stringify(f) !== saved;
  useUnsavedWarning(dirty);
  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = useMutation({
    mutationFn: (body: Omit<ShippingRate, "id" | "emirate" | "updatedAt">) => adminApi.put<ShippingRate>(`/admin/shipping-rates/${emirate}`, body),
    onSuccess: (r) => {
      const next = fieldsFrom(r);
      setF(next);
      setSaved(JSON.stringify(next));
      void invalidate("/admin/shipping-rates");
      toast(`Delivery rate for ${label} saved`);
    },
  });

  const baseFils = inputToFils(f.base);
  const perKgFils = inputToFils(f.perKg);
  const freeOverFils = f.freeOver.trim() ? inputToFils(f.freeOver) : null;
  const baseKg = Number(f.baseKg);
  const maxKg = Number(f.maxKg);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const eta = Number(f.eta);
    if (baseFils === null) return setProblem("Enter the base fee in AED (0 for free delivery).");
    if (perKgFils === null) return setProblem("Enter the fee per extra kg in AED (0 if weight doesn't matter).");
    if (f.freeOver.trim() && freeOverFils === null) return setProblem("Enter the free delivery threshold in AED, or leave it empty.");
    if (![baseKg, maxKg, eta].every((n) => Number.isInteger(n) && n >= 0)) return setProblem("Weights and days must be whole numbers.");
    if (maxKg < 1) return setProblem("The weight limit must be at least 1 kg.");
    save.mutate({ baseFils, baseWeightKg: baseKg, perKgFils, freeOverFils, maxWeightKg: maxKg, etaDays: eta, active: f.active });
  };

  return (
    <Panel
      title={label}
      actions={<Badge tone={rate?.active ? "pipe" : "neutral"}>{rate ? (rate.active ? "Delivering" : "Not delivering") : "No rate set"}</Badge>}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Checkbox label={`Deliver to ${label} by courier`} checked={f.active} onChange={(e) => set("active", e.target.checked)} />
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="Base fee (AED)" inputMode="decimal" value={f.base} onChange={(e) => set("base", e.target.value)} />
          <TextField label="Includes up to (kg)" type="number" min={0} step={1} value={f.baseKg} onChange={(e) => set("baseKg", e.target.value)} />
          <TextField label="Each extra kg (AED)" inputMode="decimal" value={f.perKg} onChange={(e) => set("perKg", e.target.value)} />
          <TextField
            label="Free over (AED)"
            inputMode="decimal"
            placeholder="Never free"
            value={f.freeOver}
            onChange={(e) => set("freeOver", e.target.value)}
          />
          <TextField label="Weight limit (kg)" type="number" min={1} step={1} value={f.maxKg} onChange={(e) => set("maxKg", e.target.value)} />
          <TextField label="Delivery time (days)" type="number" min={0} step={1} value={f.eta} onChange={(e) => set("eta", e.target.value)} />
        </div>
        {baseFils !== null && perKgFils !== null && (
          <p className="rounded-[var(--radius-tag)] bg-sheet px-3 py-2 text-sm">
            Shoppers pay <strong>{formatAed(withVat(baseFils))}</strong> incl. VAT for orders up to {Number.isFinite(baseKg) ? baseKg : 0} kg
            {perKgFils > 0 && (
              <>
                , plus <strong>{formatAed(withVat(perKgFils))}</strong> for each extra kg
              </>
            )}
            {freeOverFils != null && (
              <>
                . Free when the order is over <strong>{formatAed(freeOverFils)}</strong> before VAT ({formatAed(withVat(freeOverFils))} incl. VAT)
              </>
            )}
            . Heavier than {Number.isFinite(maxKg) ? maxKg : 0} kg: store pickup only.
          </p>
        )}
        <FormError message={problem ?? (save.error ? errorMessage(save.error) : null)} />
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-galv pt-3">
          {dirty && <span className="text-sm text-[#7a5a0c]">Unsaved changes</span>}
          <Button type="submit" loading={save.isPending} disabled={!dirty}>
            Save {label} rate
          </Button>
        </div>
      </form>
    </Panel>
  );
}
