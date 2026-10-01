"use client";

import type { AdminBranch, Settings } from "@al-lahiq/api-client";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, FormError, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { adminApi, errorMessage } from "@/lib/api-browser";
import { cn } from "@/lib/cn";
import { useAdminQuery, useInvalidate } from "../data";
import { filsToInput, formatAed, inputToFils } from "../helpers";
import { useUnsavedWarning } from "../row-controls";
import { useToast } from "../toast";
import { ErrorState, Loading, PageHeader, Panel } from "../ui";

const TABS = [
  { href: "/admin/settings", label: "General" },
  { href: "/admin/settings/delivery", label: "Delivery rates" },
  { href: "/admin/settings/branches", label: "Branches" },
];

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="-mt-1 mb-5 flex gap-1 overflow-x-auto border-b border-galv">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 border-b-2 px-3 py-2 text-sm font-medium",
              active ? "border-pipe text-ink" : "border-transparent text-steel hover:text-ink",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function GeneralSettings() {
  const settings = useAdminQuery<Settings>("/admin/settings");
  const branches = useAdminQuery<AdminBranch[]>("/admin/branches");
  const error = settings.error ?? branches.error;
  return (
    <>
      <PageHeader title="Settings" description="Each section is saved on its own. Changes apply to the shop straight away." />
      <SettingsTabs />
      {error ? (
        <ErrorState error={error} onRetry={() => void settings.refetch().then(() => branches.refetch())} />
      ) : !settings.data || !branches.data ? (
        <Loading label="Loading settings" />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <StoreSection initial={settings.data.store} />
          <div className="flex flex-col gap-4">
            <CodSection initial={settings.data.cod} />
            <StockSection initial={settings.data.stock} branches={branches.data} />
          </div>
          <PickupSection initial={settings.data.pickup} />
          <SearchSection initial={settings.data.search} />
        </div>
      )}
    </>
  );
}

/** One settings section: its own form, save button and "unsaved" state. */
function useSection<K extends keyof Settings>(key: K, initial: Settings[K]) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [saved, setSaved] = useState(() => JSON.stringify(initial));
  const save = useMutation({
    mutationFn: (body: Settings[K]) => adminApi.patch<Settings[K]>(`/admin/settings/${key}`, body),
    onSuccess: (_, body) => {
      setSaved(JSON.stringify(body));
      void invalidate("/admin/settings");
      toast("Settings saved");
    },
  });
  return { save, saved };
}

function SectionForm({
  title,
  description,
  children,
  onSubmit,
  dirty,
  loading,
  error,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  onSubmit: () => void;
  dirty: boolean;
  loading: boolean;
  error: string | null;
}) {
  useUnsavedWarning(dirty);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <Panel title={title} description={description}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {children}
        <FormError message={error} />
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-galv pt-3">
          {dirty && <span className="text-sm text-[#7a5a0c]">Unsaved changes</span>}
          <Button type="submit" loading={loading} disabled={!dirty}>
            Save {title.toLowerCase()}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function StoreSection({ initial }: { initial: Settings["store"] }) {
  const { save, saved } = useSection("store", initial);
  const [f, setF] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (k: keyof Settings["store"], v: string) => setF((x) => ({ ...x, [k]: v }));
  const trimmed = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim()])) as Settings["store"];
  return (
    <SectionForm
      title="Store details"
      description="Shown in the shop footer and printed on every tax invoice."
      dirty={JSON.stringify(trimmed) !== saved}
      loading={save.isPending}
      error={problem ?? (save.error ? errorMessage(save.error) : null)}
      onSubmit={() => {
        setProblem(null);
        if (!trimmed.name || !trimmed.legalName) return setProblem("Enter the store name and the legal company name.");
        if (!/^\d{15}$/.test(trimmed.trn)) return setProblem("The TRN must be the 15 digits from your VAT certificate.");
        if (trimmed.email && !/^\S+@\S+\.\S+$/.test(trimmed.email)) return setProblem("Enter a valid email address.");
        const clean = { ...trimmed, whatsapp: trimmed.whatsapp.replace(/\D/g, "") };
        setF(clean);
        save.mutate(clean);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Store name" value={f.name} onChange={(e) => set("name", e.target.value)} />
        <TextField label="Legal company name" value={f.legalName} onChange={(e) => set("legalName", e.target.value)} hint="As on the trade licence." />
        <TextField label="TRN (VAT number)" inputMode="numeric" maxLength={15} value={f.trn} onChange={(e) => set("trn", e.target.value.replace(/\D/g, ""))} />
        <TextField label="Phone" type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
        <TextField label="Email" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
        <TextField
          label="WhatsApp number"
          inputMode="numeric"
          value={f.whatsapp}
          onChange={(e) => set("whatsapp", e.target.value)}
          hint="Digits only with country code, e.g. 971501234567."
        />
      </div>
      <TextAreaField label="Address" rows={2} value={f.address} onChange={(e) => set("address", e.target.value)} />
    </SectionForm>
  );
}

function CodSection({ initial }: { initial: Settings["cod"] }) {
  const { save, saved } = useSection("cod", initial);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [max, setMax] = useState(filsToInput(initial.maxFils));
  const [problem, setProblem] = useState<string | null>(null);
  const maxFils = inputToFils(max);
  return (
    <SectionForm
      title="Cash on delivery"
      description="Let shoppers pay the courier in cash."
      dirty={JSON.stringify({ enabled, maxFils }) !== saved}
      loading={save.isPending}
      error={problem ?? (save.error ? errorMessage(save.error) : null)}
      onSubmit={() => {
        setProblem(null);
        if (maxFils === null) return setProblem("Enter the largest order total allowed for cash on delivery, in AED.");
        save.mutate({ enabled, maxFils });
      }}
    >
      <Checkbox label="Offer cash on delivery" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
      <TextField
        label="Largest order for cash on delivery (AED, incl. VAT)"
        inputMode="decimal"
        value={max}
        onChange={(e) => setMax(e.target.value)}
        disabled={!enabled}
        hint={maxFils !== null ? `Orders above ${formatAed(maxFils)} must be paid online.` : undefined}
      />
    </SectionForm>
  );
}

function StockSection({ initial, branches }: { initial: Settings["stock"]; branches: AdminBranch[] }) {
  const { save, saved } = useSection("stock", initial);
  const [buffer, setBuffer] = useState(String(initial.safetyBuffer));
  const [branch, setBranch] = useState(initial.fulfilmentBranchCode);
  const [problem, setProblem] = useState<string | null>(null);
  const known = branches.some((b) => b.code === branch);
  return (
    <SectionForm
      title="Stock"
      description="How much of the POS stock the website may sell."
      dirty={JSON.stringify({ safetyBuffer: Number(buffer), fulfilmentBranchCode: branch }) !== saved}
      loading={save.isPending}
      error={problem ?? (save.error ? errorMessage(save.error) : null)}
      onSubmit={() => {
        setProblem(null);
        const n = Number(buffer);
        if (!Number.isInteger(n) || n < 0) return setProblem("The safety buffer must be a whole number, 0 or more.");
        save.mutate({ safetyBuffer: n, fulfilmentBranchCode: branch });
      }}
    >
      <TextField
        label="Safety buffer (units per SKU and branch)"
        type="number"
        min={0}
        step={1}
        value={buffer}
        onChange={(e) => setBuffer(e.target.value)}
        hint="Held back from online sale, so the last few items on the shelf aren't sold twice."
      />
      <SelectField
        label="Branch that ships courier orders"
        value={branch}
        onChange={(e) => setBranch(e.target.value)}
        hint="Courier orders are picked from this branch's stock."
      >
        {!known && <option value={branch}>{branch} (not a branch)</option>}
        {branches.map((b) => (
          <option key={b.id} value={b.code}>
            {b.name} ({b.code})
          </option>
        ))}
      </SelectField>
    </SectionForm>
  );
}

function PickupSection({ initial }: { initial: Settings["pickup"] }) {
  const { save, saved } = useSection("pickup", initial);
  const [f, setF] = useState(() => Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, String(v)])) as Record<keyof Settings["pickup"], string>);
  const [problem, setProblem] = useState<string | null>(null);
  const nums = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Number(v)])) as Settings["pickup"];
  const set = (k: keyof Settings["pickup"], v: string) => setF((x) => ({ ...x, [k]: v }));
  const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return (
    <SectionForm
      title="Store pickup"
      description="The pickup times shoppers can choose at checkout."
      dirty={JSON.stringify(nums) !== saved}
      loading={save.isPending}
      error={problem ?? (save.error ? errorMessage(save.error) : null)}
      onSubmit={() => {
        setProblem(null);
        if (Object.values(nums).some((n) => !Number.isInteger(n) || n < 0)) return setProblem("Every pickup setting must be a whole number.");
        if (nums.openHour > 23 || nums.closeHour > 24 || nums.closeHour <= nums.openHour)
          return setProblem("Closing hour must be after opening hour, both between 0 and 24.");
        if (nums.slotMinutes < 15) return setProblem("Pickup slots must be at least 15 minutes long.");
        if (nums.daysAhead < 1) return setProblem("Shoppers must be able to pick at least 1 day.");
        save.mutate(nums);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Preparation time (hours)" type="number" min={0} step={1} value={f.leadHours} onChange={(e) => set("leadHours", e.target.value)} hint="Earliest pickup after ordering." />
        <TextField label="Slot length (minutes)" type="number" min={15} step={15} value={f.slotMinutes} onChange={(e) => set("slotMinutes", e.target.value)} />
        <TextField label="Days shoppers can book ahead" type="number" min={1} step={1} value={f.daysAhead} onChange={(e) => set("daysAhead", e.target.value)} />
        <div />
        <TextField label="First slot starts (hour, 0 to 23)" type="number" min={0} max={23} step={1} value={f.openHour} onChange={(e) => set("openHour", e.target.value)} />
        <TextField label="Last slot ends (hour, 1 to 24)" type="number" min={1} max={24} step={1} value={f.closeHour} onChange={(e) => set("closeHour", e.target.value)} />
      </div>
      {nums.closeHour > nums.openHour && nums.slotMinutes >= 15 && (
        <p className="text-sm text-steel">
          Slots from {hour(nums.openHour)} to {hour(nums.closeHour)}, every {nums.slotMinutes} minutes, starting {nums.leadHours} hours after the order.
        </p>
      )}
    </SectionForm>
  );
}

function SearchSection({ initial }: { initial: Settings["search"] }) {
  const { save, saved } = useSection("search", initial);
  const [text, setText] = useState(() => initial.synonyms.map((g) => g.join(", ")).join("\n"));
  const groups = text
    .split("\n")
    .map((line) =>
      line
        .split(",")
        .map((w) => w.trim().toLowerCase())
        .filter(Boolean),
    )
    .filter((g) => g.length > 0);
  return (
    <SectionForm
      title="Search synonyms"
      description="Words shoppers use for the same thing, so a search for one finds the others."
      dirty={JSON.stringify({ synonyms: groups }) !== saved}
      loading={save.isPending}
      error={save.error ? errorMessage(save.error) : groups.some((g) => g.length < 2) ? "Each line needs at least two words separated by commas." : null}
      onSubmit={() => {
        if (groups.some((g) => g.length < 2)) return;
        save.mutate({ synonyms: groups });
      }}
    >
      <TextAreaField
        label="One group per line, words separated by commas"
        rows={10}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="[&_textarea]:font-mono [&_textarea]:text-[14px]"
        hint={'Example: tap, faucet, mixer. Tip: the dashboard lists "Searches with no results" to add here.'}
      />
    </SectionForm>
  );
}
