"use client";

import type { Address, Emirate } from "@al-lahiq/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { Checkbox, FormError, SelectField, TextField } from "@/components/ui/field";
import { api } from "@/lib/api-browser";
import { addressLine, EMIRATES } from "@/lib/format";
import { useMe } from "@/lib/hooks/store";
import { QueryError, friendlyError } from "./session";

type Draft = {
  label: string;
  fullName: string;
  phone: string;
  emirate: Emirate;
  area: string;
  street: string;
  building: string;
  landmark: string;
  isDefault: boolean;
};

const blank = (defaults: Partial<Draft>): Draft => ({
  label: "",
  fullName: "",
  phone: "",
  emirate: "DUBAI",
  area: "",
  street: "",
  building: "",
  landmark: "",
  isDefault: false,
  ...defaults,
});

const fromAddress = (a: Address): Draft => ({
  label: a.label ?? "",
  fullName: a.fullName,
  phone: a.phone,
  emirate: a.emirate,
  area: a.area,
  street: a.street,
  building: a.building ?? "",
  landmark: a.landmark ?? "",
  isDefault: a.isDefault,
});

/** Only the fields the API accepts; empty optional fields are cleared. */
function toBody(d: Draft) {
  const opt = (v: string) => v.trim() || null;
  return {
    label: opt(d.label),
    fullName: d.fullName.trim(),
    phone: d.phone.replace(/[\s-]/g, ""),
    emirate: d.emirate,
    area: d.area.trim(),
    street: d.street.trim(),
    building: opt(d.building),
    landmark: opt(d.landmark),
    ...(d.isDefault ? { isDefault: true } : {}),
  };
}

function AddressForm({
  initial,
  onSave,
  onCancel,
  saving,
  error,
  submitLabel,
  showDefault,
}: {
  initial: Draft;
  onSave: (d: Draft) => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
  submitLabel: string;
  showDefault: boolean;
}) {
  const [d, setD] = useState(initial);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD((x) => ({ ...x, [k]: e.target.value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave(d);
  };
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <TextField
        label="Address name (optional)"
        className="sm:col-span-2"
        placeholder="e.g. Home, Office, Site – Al Barsha villa"
        value={d.label}
        onChange={set("label")}
        maxLength={60}
        hint="Helps you pick the right address at checkout"
      />
      <TextField label="Full name" autoComplete="name" value={d.fullName} onChange={set("fullName")} required minLength={2} maxLength={120} hint="Who receives the delivery" />
      <TextField label="Mobile" type="tel" autoComplete="tel" placeholder="+971 50 123 4567" value={d.phone} onChange={set("phone")} required hint="The driver calls this number" />
      <SelectField label="Emirate" value={d.emirate} onChange={(e) => setD({ ...d, emirate: e.target.value as Emirate })}>
        {EMIRATES.map((e) => (
          <option key={e.value} value={e.value}>
            {e.label}
          </option>
        ))}
      </SelectField>
      <TextField label="Area" placeholder="e.g. Al Barsha 2" value={d.area} onChange={set("area")} required minLength={2} maxLength={120} />
      <TextField label="Street" value={d.street} onChange={set("street")} required minLength={2} maxLength={200} />
      <TextField label="Building / villa / office (optional)" value={d.building} onChange={set("building")} maxLength={120} />
      <TextField
        label="Nearest landmark (optional)"
        className="sm:col-span-2"
        value={d.landmark}
        onChange={set("landmark")}
        maxLength={200}
        hint="Helps the driver find you"
      />
      {showDefault && (
        <Checkbox className="sm:col-span-2" label="Use as my default delivery address" checked={d.isDefault} onChange={(e) => setD({ ...d, isDefault: e.target.checked })} />
      )}
      <div className="sm:col-span-2" aria-live="polite">
        <FormError message={error} />
      </div>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button type="submit" loading={saving} disabled={!d.fullName || !d.phone || !d.area || !d.street}>
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function AddressCard({ address, onEdit }: { address: Address; onEdit: () => void }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["addresses"] });
  const makeDefault = useMutation({
    mutationFn: () => api.patch<Address>(`/me/addresses/${address.id}`, { isDefault: true }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async () => {
      await api.delete(`/me/addresses/${address.id}`);
      // The API doesn't pick a new default, so promote the most recent remaining address.
      if (address.isDefault) {
        const rest = await api.get<Address[]>("/me/addresses");
        if (rest.length && !rest.some((a) => a.isDefault)) await api.patch(`/me/addresses/${rest[0].id}`, { isDefault: true });
      }
    },
    onSuccess: refresh,
  });
  const error = makeDefault.error ?? remove.error;

  return (
    <li className="flex flex-col rounded-[var(--radius-panel)] border border-galv bg-paper p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl">{address.label || address.fullName}</h2>
        {address.isDefault && <Badge tone="pipe">Default</Badge>}
      </div>
      <div className="mt-1 flex-1 text-[15px]">
        {address.label && <p>{address.fullName}</p>}
        <p className="text-steel">{addressLine(address)}</p>
        {address.landmark && <p className="text-steel">Near {address.landmark}</p>}
        <p className="text-steel">{address.phone}</p>
      </div>
      <div className="mt-3 border-t border-galv pt-3" aria-live="polite">
        {confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px]">Delete this address?</span>
            <Button size="sm" variant="danger" onClick={() => remove.mutate()} loading={remove.isPending}>
              Delete address
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="secondary" onClick={onEdit}>
              Edit
            </Button>
            {!address.isDefault && (
              <Button size="sm" variant="ghost" onClick={() => makeDefault.mutate()} loading={makeDefault.isPending}>
                Set as default
              </Button>
            )}
            <Button size="sm" variant="ghost" className="text-steel hover:text-signal" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          </div>
        )}
        {error && <FormError message={friendlyError(error)} />}
      </div>
    </li>
  );
}

export function AddressBook() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const defaults: Partial<Draft> = me ? { fullName: `${me.firstName} ${me.lastName}`.trim(), phone: me.phone ?? "" } : {};
  const { data: addresses, isLoading, error } = useQuery({
    queryKey: ["addresses"],
    queryFn: () => api.get<Address[]>("/me/addresses"),
  });
  // "new", an address id, or null when no form is open.
  const [editing, setEditing] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: ({ id, draft }: { id: string | null; draft: Draft }) =>
      id ? api.patch<Address>(`/me/addresses/${id}`, toBody(draft)) : api.post<Address>("/me/addresses", toBody(draft)),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["addresses"] });
      setEditing(null);
    },
  });

  const open = (id: string | null) => {
    save.reset();
    setEditing(id);
  };

  const editingAddress = addresses?.find((a) => a.id === editing);
  const formTitle = editing === "new" ? "Add an address" : "Edit address";

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl">Addresses</h1>
          <p className="mt-1 text-steel">Save your home, office and site addresses to check out faster.</p>
        </div>
        {editing === null && addresses && addresses.length > 0 && (
          <Button onClick={() => open("new")}>
            <Plus className="size-4" aria-hidden /> Add an address
          </Button>
        )}
      </div>

      {editing !== null && (editing === "new" || editingAddress) && (
        <section aria-labelledby="address-form" className="mt-6 rounded-[var(--radius-panel)] border border-galv bg-paper p-5">
          <h2 id="address-form" className="mb-4 text-2xl">
            {formTitle}
          </h2>
          <AddressForm
            key={editing}
            initial={editingAddress ? fromAddress(editingAddress) : blank(defaults)}
            onSave={(draft) => save.mutate({ id: editing === "new" ? null : editing, draft })}
            onCancel={() => open(null)}
            saving={save.isPending}
            error={save.error ? friendlyError(save.error) : null}
            submitLabel="Save address"
            showDefault={!editingAddress?.isDefault && (addresses?.length ?? 0) > 0}
          />
        </section>
      )}

      <div className="mt-6">
        {isLoading ? (
          <p className="text-steel">Loading your addresses…</p>
        ) : error ? (
          <QueryError error={error} />
        ) : addresses && addresses.length > 0 ? (
          <ul className="grid gap-4 sm:grid-cols-2">
            {addresses.map((a) => (
              <AddressCard key={a.id} address={a} onEdit={() => open(a.id)} />
            ))}
          </ul>
        ) : (
          editing === null && (
            <EmptyState
              title="No saved addresses"
              action={
                <Button onClick={() => open("new")}>
                  <MapPin className="size-4" aria-hidden /> Add an address
                </Button>
              }
            >
              Add the places you order to, like your home or a site, and pick them at checkout.
            </EmptyState>
          )
        )}
      </div>
    </div>
  );
}
