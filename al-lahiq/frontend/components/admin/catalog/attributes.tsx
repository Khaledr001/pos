"use client";

import type { AdminAttribute } from "@al-lahiq/api-client";
import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { Checkbox, FormError, TextField } from "@/components/ui/field";
import { adminApi, errorMessage } from "@/lib/api-browser";
import { useAdminQuery, useInvalidate } from "../data";
import { ConfirmModal, Modal } from "../modal";
import { useToast } from "../toast";
import { DataTable, ErrorState, FormActions, Loading, num, PageHeader, Panel } from "../ui";

const toCode = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/, "")
    .slice(0, 40);

export function AttributesView() {
  const { data, error, isPending, refetch } = useAdminQuery<AdminAttribute[]>("/admin/attributes");
  const [editing, setEditing] = useState<AdminAttribute | "new" | null>(null);
  const [deleting, setDeleting] = useState<AdminAttribute | null>(null);
  const invalidate = useInvalidate();
  const toast = useToast();

  const remove = useMutation({
    mutationFn: (a: AdminAttribute) => adminApi.delete(`/admin/attributes/${a.id}`),
    onSuccess: (_, a) => {
      void invalidate("/admin/attributes");
      setDeleting(null);
      toast(`Filter “${a.name}” deleted`);
    },
  });

  return (
    <>
      <PageHeader
        title="Filter attributes"
        description="Properties like size, colour or current rating. Give each SKU its values on the product page; filterable ones appear as filters in category pages."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden />
            New attribute
          </Button>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isPending ? (
        <Loading label="Loading attributes" />
      ) : !data.length ? (
        <EmptyState title="No attributes yet" action={<Button onClick={() => setEditing("new")}>New attribute</Button>} />
      ) : (
        <Panel flush>
          <DataTable minWidth={600}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Code</th>
                <th scope="col">Unit</th>
                <th scope="col">Shop filter</th>
                <th scope="col" className="!text-right">
                  Sort
                </th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id}>
                  <th scope="row">
                    <button type="button" onClick={() => setEditing(a)} className="text-left font-medium hover:text-pipe hover:underline">
                      {a.name}
                    </button>
                  </th>
                  <td className="font-mono text-[13px]">{a.code}</td>
                  <td>{a.unit ?? <span className="text-steel-light">None</span>}</td>
                  <td>
                    <Badge tone={a.filterable ? "pipe" : "neutral"}>{a.filterable ? "Shown" : "Not shown"}</Badge>
                  </td>
                  <td className={num}>{a.sortOrder}</td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(a)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-signal hover:bg-signal-tint"
                        onClick={() => {
                          remove.reset();
                          setDeleting(a);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing && editing !== "new" ? `Edit ${editing.name}` : "New attribute"} size="sm">
        {editing && (
          <AttributeForm
            key={editing === "new" ? "new" : editing.id}
            attribute={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onDone={(a, created) => {
              setEditing(null);
              void invalidate("/admin/attributes");
              toast(created ? `Filter “${a.name}” created` : `Filter “${a.name}” saved`);
            }}
          />
        )}
      </Modal>
      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
        title={`Delete ${deleting?.name ?? "attribute"}?`}
        confirmLabel="Delete attribute"
        loading={remove.isPending}
        error={remove.error ? errorMessage(remove.error) : null}
      >
        Every SKU loses its {deleting?.name.toLowerCase()} value, and the filter disappears from the shop. This can&apos;t be undone.
      </ConfirmModal>
    </>
  );
}

function AttributeForm({
  attribute,
  onDone,
  onCancel,
}: {
  attribute: AdminAttribute | null;
  onDone: (a: AdminAttribute, created: boolean) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(attribute?.name ?? "");
  const [code, setCode] = useState(attribute?.code ?? "");
  const [codeTouched, setCodeTouched] = useState(!!attribute);
  const [unit, setUnit] = useState(attribute?.unit ?? "");
  const [filterable, setFilterable] = useState(attribute?.filterable ?? true);
  const [sortOrder, setSortOrder] = useState(String(attribute?.sortOrder ?? 0));
  const [problem, setProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      attribute ? adminApi.patch<AdminAttribute>(`/admin/attributes/${attribute.id}`, body) : adminApi.post<AdminAttribute>("/admin/attributes", body),
    onSuccess: (a) => onDone(a, !attribute),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!name.trim()) return setProblem("Enter a name shoppers will see, like “Size”.");
    if (!/^[a-z][a-z0-9_]*$/.test(code)) return setProblem("The code must start with a letter and use only lowercase letters, numbers and underscores.");
    const sort = Number(sortOrder);
    if (!Number.isInteger(sort)) return setProblem("Sort order must be a whole number.");
    save.mutate({ name: name.trim(), code, unit: unit.trim() || null, filterable, sortOrder: sort });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormError message={problem ?? (save.error ? errorMessage(save.error) : null)} />
      <TextField
        label="Name"
        required
        maxLength={80}
        autoFocus
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (!codeTouched) setCode(toCode(e.target.value));
        }}
      />
      <TextField
        label="Code"
        value={code}
        onChange={(e) => {
          setCodeTouched(true);
          setCode(e.target.value.toLowerCase().replace(/[\s-]+/g, "_"));
        }}
        hint="Used in filter links, e.g. cable_size. Lowercase letters, numbers and underscores."
      />
      <TextField label="Unit (optional)" maxLength={20} placeholder="e.g. mm, A, L" value={unit} onChange={(e) => setUnit(e.target.value)} />
      <TextField label="Sort order" type="number" step={1} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} hint="Lower numbers are listed first." />
      <Checkbox label="Show as a filter in category pages" checked={filterable} onChange={(e) => setFilterable(e.target.checked)} />
      <FormActions className="justify-end">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {attribute ? "Save changes" : "Create attribute"}
        </Button>
      </FormActions>
    </form>
  );
}
