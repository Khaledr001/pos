"use client";

import type { AdminBrand } from "@al-lahiq/api-client";
import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { Checkbox, FormError, TextAreaField, TextField } from "@/components/ui/field";
import { adminApi, ApiError, errorMessage } from "@/lib/api-browser";
import { useAdminQuery, useInvalidate } from "../data";
import { slugify } from "../helpers";
import { ConfirmModal, Modal } from "../modal";
import { useToast } from "../toast";
import { DataTable, ErrorState, FormActions, Loading, num, PageHeader, Panel, Thumb } from "../ui";
import { ImageInput } from "../upload";

export function BrandsView() {
  const { data, error, isPending, refetch } = useAdminQuery<AdminBrand[]>("/admin/brands");
  const [editing, setEditing] = useState<AdminBrand | "new" | null>(null);
  const [deleting, setDeleting] = useState<AdminBrand | null>(null);
  const invalidate = useInvalidate();
  const toast = useToast();

  const remove = useMutation({
    mutationFn: (b: AdminBrand) => adminApi.delete(`/admin/brands/${b.id}`),
    onSuccess: (_, b) => {
      void invalidate("/admin/brands");
      setDeleting(null);
      toast(`Brand “${b.name}” deleted`);
    },
  });
  const deleteError = !remove.error
    ? null
    : remove.error instanceof ApiError && remove.error.code === "BRAND_IN_USE"
      ? `${remove.error.message}. Give those products another brand first, or hide the brand instead.`
      : errorMessage(remove.error);

  return (
    <>
      <PageHeader
        title="Brands"
        description="Featured brands appear on the home page. Hidden brands keep their products but have no brand page."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden />
            New brand
          </Button>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isPending ? (
        <Loading label="Loading brands" />
      ) : !data.length ? (
        <EmptyState title="No brands yet" action={<Button onClick={() => setEditing("new")}>New brand</Button>} />
      ) : (
        <Panel flush>
          <DataTable minWidth={640}>
            <thead>
              <tr>
                <th scope="col">Brand</th>
                <th scope="col" className="!text-right">
                  Products
                </th>
                <th scope="col">Shop</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((b) => (
                <tr key={b.id}>
                  <th scope="row">
                    <div className="flex items-center gap-2.5">
                      <Thumb url={b.logoUrl} alt="" size={36} />
                      <div>
                        <button type="button" onClick={() => setEditing(b)} className="text-left font-medium hover:text-pipe hover:underline">
                          {b.name}
                        </button>
                        <p className="font-mono text-[12px] text-steel">/brand/{b.slug}</p>
                      </div>
                    </div>
                  </th>
                  <td className={num}>{b._count.products}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={b.active ? "pipe" : "neutral"}>{b.active ? "Visible" : "Hidden"}</Badge>
                      {b.featured && <Badge tone="brass">Featured</Badge>}
                    </div>
                  </td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(b)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-signal hover:bg-signal-tint"
                        onClick={() => {
                          remove.reset();
                          setDeleting(b);
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

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing && editing !== "new" ? `Edit ${editing.name}` : "New brand"}>
        {editing && (
          <BrandForm
            key={editing === "new" ? "new" : editing.id}
            brand={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onDone={(b, created) => {
              setEditing(null);
              void invalidate("/admin/brands");
              toast(created ? `Brand “${b.name}” created` : `Brand “${b.name}” saved`);
            }}
          />
        )}
      </Modal>
      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
        title={`Delete ${deleting?.name ?? "brand"}?`}
        confirmLabel="Delete brand"
        loading={remove.isPending}
        error={deleteError}
      >
        Only brands with no products can be deleted.
      </ConfirmModal>
    </>
  );
}

function BrandForm({ brand, onDone, onCancel }: { brand: AdminBrand | null; onDone: (b: AdminBrand, created: boolean) => void; onCancel: () => void }) {
  const [name, setName] = useState(brand?.name ?? "");
  const [slug, setSlug] = useState(brand?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!brand);
  const [logoUrl, setLogoUrl] = useState<string | null>(brand?.logoUrl ?? null);
  const [description, setDescription] = useState(brand?.description ?? "");
  const [featured, setFeatured] = useState(brand?.featured ?? false);
  const [active, setActive] = useState(brand?.active ?? true);
  const [problem, setProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      brand ? adminApi.patch<AdminBrand>(`/admin/brands/${brand.id}`, body) : adminApi.post<AdminBrand>("/admin/brands", body),
    onSuccess: (b) => onDone(b, !brand),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!name.trim()) return setProblem("Enter the brand name.");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return setProblem("The web address can only use lowercase letters, numbers and single dashes.");
    save.mutate({ name: name.trim(), slug, logoUrl, description: description.trim() ? description : null, featured, active });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormError message={problem ?? (save.error ? errorMessage(save.error) : null)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Name"
          required
          maxLength={120}
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
        />
        <TextField
          label="Web address"
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"));
          }}
          hint={<>Shown as /brand/{slug || "…"}</>}
        />
      </div>
      <ImageInput label="Logo" value={logoUrl} onChange={setLogoUrl} hint="A transparent PNG or SVG looks best." />
      <TextAreaField
        label="Description (optional)"
        rows={3}
        maxLength={5000}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        hint="Shown on the brand page."
      />
      <div className="flex flex-col gap-2">
        <Checkbox label="Visible in the shop" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <Checkbox label="Featured on the home page" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
      </div>
      <FormActions className="justify-end">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {brand ? "Save changes" : "Create brand"}
        </Button>
      </FormActions>
    </form>
  );
}
