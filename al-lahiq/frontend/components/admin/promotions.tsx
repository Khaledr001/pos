"use client";

import type { Coupon, CouponType } from "@al-lahiq/api-client";
import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { Checkbox, FormError, SelectField, TextField } from "@/components/ui/field";
import { adminApi, errorMessage } from "@/lib/api-browser";
import { formatDateTime } from "@/lib/format";
import { useAdminQuery, useInvalidate } from "./data";
import { filsToInput, formatAed, inputToFils, isoToLocalInput, localInputToIso } from "./helpers";
import { ConfirmModal, Modal } from "./modal";
import { useToast } from "./toast";
import { DataTable, ErrorState, FormActions, Loading, num, PageHeader, Panel } from "./ui";

function discountText(c: Pick<Coupon, "type" | "value">) {
  if (c.type === "PERCENT") return `${c.value}% off`;
  if (c.type === "FIXED") return `${formatAed(c.value)} off`;
  return "Free delivery";
}

function couponState(c: Coupon, now: number) {
  if (!c.active) return { label: "Switched off", tone: "neutral" as const };
  if (c.maxUses != null && c.usedCount >= c.maxUses) return { label: "Used up", tone: "neutral" as const };
  if (c.validFrom && new Date(c.validFrom).getTime() > now) return { label: "Scheduled", tone: "brass" as const };
  if (c.validTo && new Date(c.validTo).getTime() < now) return { label: "Expired", tone: "neutral" as const };
  return { label: "Active", tone: "pipe" as const };
}

export function PromotionsView() {
  const { data, error, isPending, refetch, dataUpdatedAt } = useAdminQuery<Coupon[]>("/admin/coupons");
  const [editing, setEditing] = useState<Coupon | "new" | null>(null);
  const [deleting, setDeleting] = useState<Coupon | null>(null);
  const invalidate = useInvalidate();
  const toast = useToast();
  const remove = useMutation({
    mutationFn: (c: Coupon) => adminApi.delete(`/admin/coupons/${c.id}`),
    onSuccess: (_, c) => {
      void invalidate("/admin/coupons");
      setDeleting(null);
      toast(`Coupon ${c.code} deleted`);
    },
  });

  return (
    <>
      <PageHeader
        title="Promotions"
        description="Coupon codes shoppers enter in the cart. Amounts are before VAT."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden />
            New coupon
          </Button>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isPending ? (
        <Loading label="Loading coupons" />
      ) : !data.length ? (
        <EmptyState title="No coupons yet" action={<Button onClick={() => setEditing("new")}>New coupon</Button>}>
          Create a code like WELCOME10 for 10% off a first order.
        </EmptyState>
      ) : (
        <Panel flush>
          <DataTable minWidth={820}>
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Discount</th>
                <th scope="col" className="!text-right">
                  Minimum order
                </th>
                <th scope="col" className="!text-right">
                  Used
                </th>
                <th scope="col">Valid</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => {
                const st = couponState(c, dataUpdatedAt);
                return (
                  <tr key={c.id}>
                    <th scope="row">
                      <button type="button" onClick={() => setEditing(c)} className="font-mono font-semibold hover:text-pipe hover:underline">
                        {c.code}
                      </button>
                    </th>
                    <td>{discountText(c)}</td>
                    <td className={num}>{c.minSubtotalFils ? formatAed(c.minSubtotalFils) : <span className="font-sans font-normal text-steel">None</span>}</td>
                    <td className={num}>
                      {c.usedCount}
                      {c.maxUses != null && <span className="font-sans font-normal text-steel"> of {c.maxUses}</span>}
                    </td>
                    <td className="text-[13px]">
                      {c.validFrom || c.validTo ? (
                        <>
                          <p>From {c.validFrom ? formatDateTime(c.validFrom) : "now"}</p>
                          <p>Until {c.validTo ? formatDateTime(c.validTo) : "switched off"}</p>
                        </>
                      ) : (
                        <span className="text-steel">No end date</span>
                      )}
                    </td>
                    <td>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-signal hover:bg-signal-tint"
                          onClick={() => {
                            remove.reset();
                            setDeleting(c);
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        </Panel>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing && editing !== "new" ? `Edit ${editing.code}` : "New coupon"}>
        {editing && (
          <CouponForm
            key={editing === "new" ? "new" : editing.id}
            coupon={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onDone={(c, created) => {
              setEditing(null);
              void invalidate("/admin/coupons");
              toast(created ? `Coupon ${c.code} created` : `Coupon ${c.code} saved`);
            }}
          />
        )}
      </Modal>
      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
        title={`Delete coupon ${deleting?.code ?? ""}?`}
        confirmLabel="Delete coupon"
        loading={remove.isPending}
        error={remove.error ? errorMessage(remove.error) : null}
      >
        Shoppers can no longer use it. Orders that already used it are not affected. To pause it instead, switch it off.
      </ConfirmModal>
    </>
  );
}

function CouponForm({ coupon, onDone, onCancel }: { coupon: Coupon | null; onDone: (c: Coupon, created: boolean) => void; onCancel: () => void }) {
  const [code, setCode] = useState(coupon?.code ?? "");
  const [type, setType] = useState<CouponType>(coupon?.type ?? "PERCENT");
  const [percent, setPercent] = useState(coupon?.type === "PERCENT" ? String(coupon.value) : "10");
  const [amount, setAmount] = useState(coupon?.type === "FIXED" ? filsToInput(coupon.value) : "");
  const [minSubtotal, setMinSubtotal] = useState(coupon?.minSubtotalFils ? filsToInput(coupon.minSubtotalFils) : "");
  const [maxUses, setMaxUses] = useState(coupon?.maxUses != null ? String(coupon.maxUses) : "");
  const [validFrom, setValidFrom] = useState(isoToLocalInput(coupon?.validFrom));
  const [validTo, setValidTo] = useState(isoToLocalInput(coupon?.validTo));
  const [active, setActive] = useState(coupon?.active ?? true);
  const [problem, setProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      coupon ? adminApi.patch<Coupon>(`/admin/coupons/${coupon.id}`, body) : adminApi.post<Coupon>("/admin/coupons", body),
    onSuccess: (c) => onDone(c, !coupon),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!/^[A-Z0-9_-]{3,40}$/.test(code)) return setProblem("The code needs 3 to 40 letters, numbers, dashes or underscores, with no spaces.");
    let value = 0;
    if (type === "PERCENT") {
      value = Number(percent);
      if (!Number.isInteger(value) || value < 1 || value > 100) return setProblem("Enter a whole percentage from 1 to 100.");
    } else if (type === "FIXED") {
      const fils = inputToFils(amount);
      if (!fils) return setProblem("Enter the discount amount in AED, for example 25.");
      value = fils;
    }
    let minSubtotalFils = 0;
    if (minSubtotal.trim()) {
      const f = inputToFils(minSubtotal);
      if (f === null) return setProblem("Enter the minimum order in AED, for example 200, or leave it empty.");
      minSubtotalFils = f;
    }
    let uses: number | null = null;
    if (maxUses.trim()) {
      uses = Number(maxUses);
      if (!Number.isInteger(uses) || uses < 1) return setProblem("Maximum uses must be a whole number of at least 1, or empty for no limit.");
    }
    const from = localInputToIso(validFrom);
    const to = localInputToIso(validTo);
    if (from && to && to <= from) return setProblem("The end date must be after the start date.");
    save.mutate({ code, type, value, minSubtotalFils, maxUses: uses, validFrom: from, validTo: to, active });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormError message={problem ?? (save.error ? errorMessage(save.error) : null)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Code"
          required
          maxLength={40}
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s+/g, ""))}
          className="[&_input]:font-mono [&_input]:uppercase"
          hint="What shoppers type in the cart."
        />
        <SelectField label="Discount type" value={type} onChange={(e) => setType(e.target.value as CouponType)}>
          <option value="PERCENT">Percentage off</option>
          <option value="FIXED">Fixed amount off</option>
          <option value="FREE_SHIPPING">Free delivery</option>
        </SelectField>
        {type === "PERCENT" && (
          <TextField label="Percentage off" type="number" min={1} max={100} step={1} inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value)} hint="From 1 to 100." />
        )}
        {type === "FIXED" && (
          <TextField label="Amount off (AED, excl. VAT)" inputMode="decimal" placeholder="25.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        )}
        <TextField
          label="Minimum order (AED, excl. VAT)"
          inputMode="decimal"
          placeholder="No minimum"
          value={minSubtotal}
          onChange={(e) => setMinSubtotal(e.target.value)}
          hint="Cart subtotal needed before the code works."
        />
        <TextField
          label="Maximum uses"
          type="number"
          min={1}
          step={1}
          placeholder="No limit"
          value={maxUses}
          onChange={(e) => setMaxUses(e.target.value)}
          hint={coupon ? `Used ${coupon.usedCount} times so far.` : "Across all customers."}
        />
        <TextField label="Valid from (optional)" type="datetime-local" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        <TextField label="Valid until (optional)" type="datetime-local" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
      </div>
      <Checkbox label="Switched on" checked={active} onChange={(e) => setActive(e.target.checked)} />
      <FormActions className="justify-end">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {coupon ? "Save changes" : "Create coupon"}
        </Button>
      </FormActions>
    </form>
  );
}
