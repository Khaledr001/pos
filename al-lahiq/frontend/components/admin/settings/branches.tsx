"use client";

import type { AdminBranch, Emirate } from "@al-lahiq/api-client";
import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { Checkbox, FormError, SelectField, TextField } from "@/components/ui/field";
import { adminApi, errorMessage } from "@/lib/api-browser";
import { EMIRATES, emirateName } from "@/lib/format";
import { useAdminQuery, useInvalidate } from "../data";
import { Modal } from "../modal";
import { useToast } from "../toast";
import { DataTable, ErrorState, FormActions, Loading, PageHeader, Panel } from "../ui";
import { SettingsTabs } from "./general";

const DAYS = [
  ["mon", "Monday"],
  ["tue", "Tuesday"],
  ["wed", "Wednesday"],
  ["thu", "Thursday"],
  ["fri", "Friday"],
  ["sat", "Saturday"],
  ["sun", "Sunday"],
] as const;

function hoursOf(b: AdminBranch | null): Record<string, string> {
  const h = b?.openingHours;
  if (!h || typeof h !== "object" || Array.isArray(h)) return {};
  return Object.fromEntries(Object.entries(h as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")]));
}

export function BranchesSettings() {
  const { data, error, isPending, refetch } = useAdminQuery<AdminBranch[]>("/admin/branches");
  const [editing, setEditing] = useState<AdminBranch | "new" | null>(null);
  const invalidate = useInvalidate();
  const toast = useToast();

  return (
    <>
      <PageHeader
        title="Branches"
        description="Your shops and warehouses. Stock arrives from the POS per branch code; branches with pickup switched on appear at checkout."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden />
            New branch
          </Button>
        }
      />
      <SettingsTabs />
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isPending ? (
        <Loading label="Loading branches" />
      ) : !data.length ? (
        <EmptyState title="No branches yet" action={<Button onClick={() => setEditing("new")}>New branch</Button>} />
      ) : (
        <Panel flush>
          <DataTable minWidth={760}>
            <thead>
              <tr>
                <th scope="col">Branch</th>
                <th scope="col">POS code</th>
                <th scope="col">Address</th>
                <th scope="col">Opening hours</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((b) => {
                const hours = hoursOf(b);
                return (
                  <tr key={b.id}>
                    <th scope="row">
                      <button type="button" onClick={() => setEditing(b)} className="text-left font-medium hover:text-pipe hover:underline">
                        {b.name}
                      </button>
                      <p className="text-[13px] text-steel">{emirateName(b.emirate)}</p>
                    </th>
                    <td className="font-mono text-[13px]">{b.code}</td>
                    <td className="max-w-64">
                      <p>{b.address}</p>
                      {b.phone && <p className="text-[13px] text-steel">{b.phone}</p>}
                    </td>
                    <td className="text-[13px]">
                      {Object.keys(hours).length ? (
                        <dl className="grid grid-cols-[auto_1fr] gap-x-2">
                          {DAYS.filter(([k]) => hours[k]).map(([k, name]) => (
                            <div key={k} className="contents">
                              <dt className="text-steel">{name.slice(0, 3)}</dt>
                              <dd>{hours[k]}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <span className="text-steel">Not set</span>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={b.active ? "pipe" : "neutral"}>{b.active ? "Open" : "Closed"}</Badge>
                        {b.pickupEnabled && b.active && <Badge tone="neutral">Pickup</Badge>}
                      </div>
                    </td>
                    <td>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(b)}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        </Panel>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing && editing !== "new" ? `Edit ${editing.name}` : "New branch"} size="lg">
        {editing && (
          <BranchForm
            key={editing === "new" ? "new" : editing.id}
            branch={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onDone={(b, created) => {
              setEditing(null);
              void invalidate("/admin/branches");
              toast(created ? `Branch ${b.name} created` : `Branch ${b.name} saved`);
            }}
          />
        )}
      </Modal>
    </>
  );
}

function BranchForm({ branch, onDone, onCancel }: { branch: AdminBranch | null; onDone: (b: AdminBranch, created: boolean) => void; onCancel: () => void }) {
  const [code, setCode] = useState(branch?.code ?? "");
  const [name, setName] = useState(branch?.name ?? "");
  const [emirate, setEmirate] = useState<Emirate>(branch?.emirate ?? "DUBAI");
  const [address, setAddress] = useState(branch?.address ?? "");
  const [phone, setPhone] = useState(branch?.phone ?? "");
  const [lat, setLat] = useState(branch?.lat != null ? String(branch.lat) : "");
  const [lng, setLng] = useState(branch?.lng != null ? String(branch.lng) : "");
  const [hours, setHours] = useState<Record<string, string>>(() => hoursOf(branch));
  const [pickupEnabled, setPickupEnabled] = useState(branch?.pickupEnabled ?? true);
  const [active, setActive] = useState(branch?.active ?? true);
  const [problem, setProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      branch ? adminApi.patch<AdminBranch>(`/admin/branches/${branch.id}`, body) : adminApi.post<AdminBranch>("/admin/branches", body),
    onSuccess: (b) => onDone(b, !branch),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!/^[A-Z0-9_-]{2,20}$/.test(code)) return setProblem("The POS code needs 2 to 20 capital letters, numbers, dashes or underscores.");
    if (name.trim().length < 2) return setProblem("Enter the branch name.");
    if (address.trim().length < 2) return setProblem("Enter the branch address.");
    const coord = (v: string, max: number) => {
      if (!v.trim()) return null;
      const n = Number(v);
      return Number.isFinite(n) && Math.abs(n) <= max ? n : NaN;
    };
    const la = coord(lat, 90);
    const ln = coord(lng, 180);
    if (Number.isNaN(la) || Number.isNaN(ln)) return setProblem("Latitude and longitude must be numbers, like 25.1379 and 55.2343. Copy them from Google Maps.");
    const openingHours = Object.fromEntries(
      DAYS.map(([k]) => [k, (hours[k] ?? "").trim()]).filter(([, v]) => v),
    );
    save.mutate({
      code,
      name: name.trim(),
      emirate,
      address: address.trim(),
      phone: phone.trim() || null,
      lat: la,
      lng: ln,
      openingHours,
      pickupEnabled,
      active,
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormError message={problem ?? (save.error ? errorMessage(save.error) : null)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="POS branch code"
          required
          maxLength={20}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s+/g, ""))}
          className="[&_input]:font-mono"
          hint="Must match the branch code in the POS exactly, or its stock won't arrive."
        />
        <TextField label="Name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        <SelectField label="Emirate" value={emirate} onChange={(e) => setEmirate(e.target.value as Emirate)}>
          {EMIRATES.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </SelectField>
        <TextField label="Phone (optional)" type="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <TextField label="Address" required maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Latitude (optional)" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="25.1379" />
        <TextField label="Longitude (optional)" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="55.2343" />
      </div>
      <fieldset className="rounded-[var(--radius-tag)] border border-galv p-3">
        <legend className="px-1 text-sm font-medium">Opening hours</legend>
        <p className="mb-3 text-sm text-steel">For example 07:30-20:00, or 07:30-12:00, 14:00-20:00 for a split day. Leave a day empty if closed.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {DAYS.map(([k, label]) => (
            <TextField key={k} label={label} value={hours[k] ?? ""} placeholder="Closed" onChange={(e) => setHours((h) => ({ ...h, [k]: e.target.value }))} />
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-2">
        <Checkbox label="Open (stock from this branch counts)" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <Checkbox label="Offer store pickup here" checked={pickupEnabled} onChange={(e) => setPickupEnabled(e.target.checked)} />
      </div>
      <FormActions className="justify-end">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {branch ? "Save changes" : "Create branch"}
        </Button>
      </FormActions>
    </form>
  );
}
