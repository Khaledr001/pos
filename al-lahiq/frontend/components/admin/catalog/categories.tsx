"use client";

import type { AdminCategory } from "@al-lahiq/api-client";
import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { Checkbox, FormError, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { adminApi, ApiError, errorMessage } from "@/lib/api-browser";
import { cn } from "@/lib/cn";
import { categoryOptions, categoryTree } from "../catalog-helpers";
import { useAdminQuery, useInvalidate } from "../data";
import { pluralize, slugify } from "../helpers";
import { ConfirmModal, Modal } from "../modal";
import { useToast } from "../toast";
import { DataTable, ErrorState, FormActions, Loading, num, PageHeader, Panel, Thumb } from "../ui";
import { ImageInput } from "../upload";

type Editing = { mode: "create"; parentId: string | null } | { mode: "edit"; category: AdminCategory };

export function CategoriesView() {
  const { data, error, isPending, refetch } = useAdminQuery<AdminCategory[]>("/admin/categories");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<AdminCategory | null>(null);
  const invalidate = useInvalidate();
  const toast = useToast();

  const remove = useMutation({
    mutationFn: (c: AdminCategory) => adminApi.delete(`/admin/categories/${c.id}`),
    onSuccess: (_, c) => {
      void invalidate("/admin/categories");
      setDeleting(null);
      toast(`Category “${c.name}” deleted`);
    },
  });

  const deleteError = (() => {
    if (!remove.error || !deleting) return null;
    if (remove.error instanceof ApiError && remove.error.code === "CATEGORY_IN_USE") {
      const parts = [
        deleting._count.products && pluralize(deleting._count.products, "product"),
        deleting._count.children && pluralize(deleting._count.children, "subcategory", "subcategories"),
      ].filter(Boolean);
      return `This category still has ${parts.join(" and ") || "products or subcategories"}. Move them to another category first, or hide the category instead.`;
    }
    return errorMessage(remove.error);
  })();

  return (
    <>
      <PageHeader
        title="Categories"
        description="The departments and categories shoppers browse. Within each level, lower sort numbers are listed first."
        actions={
          <Button onClick={() => setEditing({ mode: "create", parentId: null })}>
            <Plus className="size-4" aria-hidden />
            New category
          </Button>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isPending ? (
        <Loading label="Loading categories" />
      ) : !data.length ? (
        <EmptyState title="No categories yet" action={<Button onClick={() => setEditing({ mode: "create", parentId: null })}>New category</Button>}>
          Start with top-level departments such as Plumbing or Electrical.
        </EmptyState>
      ) : (
        <Panel flush>
          <DataTable minWidth={760}>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col" className="!text-right">
                  Products
                </th>
                <th scope="col" className="!text-right">
                  Subcategories
                </th>
                <th scope="col" className="!text-right">
                  Sort
                </th>
                <th scope="col">Shop</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {categoryTree(data).map(({ category: c, depth }) => (
                <tr key={c.id}>
                  <th scope="row">
                    <div className="flex items-center gap-2.5" style={{ paddingLeft: depth * 24 }}>
                      {depth > 0 && <span aria-hidden className="h-4 w-3 shrink-0 -translate-y-1 border-b border-l border-steel-light/60" />}
                      <Thumb url={c.imageUrl} alt="" size={32} />
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => setEditing({ mode: "edit", category: c })}
                          className={cn("text-left hover:text-pipe hover:underline", depth === 0 ? "font-semibold" : "font-medium")}
                        >
                          {c.name}
                        </button>
                        <p className="font-mono text-[12px] text-steel">/category/{c.slug}</p>
                      </div>
                    </div>
                  </th>
                  <td className={num}>
                    {c._count.products ? (
                      <Link href={`/admin/products?categoryId=${c.id}`} className="hover:text-pipe hover:underline">
                        {c._count.products}
                      </Link>
                    ) : (
                      <span className="text-steel-light">0</span>
                    )}
                  </td>
                  <td className={num}>{c._count.children || <span className="text-steel-light">0</span>}</td>
                  <td className={num}>{c.sortOrder}</td>
                  <td>
                    <Badge tone={c.active ? "pipe" : "neutral"}>{c.active ? "Visible" : "Hidden"}</Badge>
                  </td>
                  <td>
                    <div className="flex justify-end gap-1 whitespace-nowrap">
                      <Button variant="ghost" size="sm" onClick={() => setEditing({ mode: "edit", category: c })}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditing({ mode: "create", parentId: c.id })}>
                        Add subcategory
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
              ))}
            </tbody>
          </DataTable>
        </Panel>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.mode === "edit" ? `Edit ${editing.category.name}` : "New category"}
        size="lg"
      >
        {editing && data && (
          <CategoryForm
            key={editing.mode === "edit" ? editing.category.id : `new-${editing.parentId}`}
            editing={editing}
            categories={data}
            onDone={(c, created) => {
              setEditing(null);
              void invalidate("/admin/categories");
              toast(created ? `Category “${c.name}” created` : `Category “${c.name}” saved`);
            }}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
        title={`Delete ${deleting?.name ?? "category"}?`}
        confirmLabel="Delete category"
        loading={remove.isPending}
        error={deleteError}
      >
        Its page disappears from the shop. Only empty categories can be deleted.
      </ConfirmModal>
    </>
  );
}

function CategoryForm({
  editing,
  categories,
  onDone,
  onCancel,
}: {
  editing: Editing;
  categories: AdminCategory[];
  onDone: (c: AdminCategory, created: boolean) => void;
  onCancel: () => void;
}) {
  const c = editing.mode === "edit" ? editing.category : null;
  const [name, setName] = useState(c?.name ?? "");
  const [slug, setSlug] = useState(c?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!c);
  const [parentId, setParentId] = useState(c ? (c.parentId ?? "") : ((editing.mode === "create" && editing.parentId) || ""));
  const [description, setDescription] = useState(c?.description ?? "");
  const [imageUrl, setImageUrl] = useState<string | null>(c?.imageUrl ?? null);
  const [sortOrder, setSortOrder] = useState(String(c?.sortOrder ?? 0));
  const [active, setActive] = useState(c?.active ?? true);
  const [seoTitle, setSeoTitle] = useState(c?.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState(c?.seoDescription ?? "");
  const [problem, setProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      c ? adminApi.patch<AdminCategory>(`/admin/categories/${c.id}`, body) : adminApi.post<AdminCategory>("/admin/categories", body),
    onSuccess: (res) => onDone(res, !c),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (name.trim().length < 2) return setProblem("Enter a category name of at least 2 characters.");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return setProblem("The web address can only use lowercase letters, numbers and single dashes.");
    const sort = Number(sortOrder);
    if (!Number.isInteger(sort)) return setProblem("Sort order must be a whole number.");
    save.mutate({
      name: name.trim(),
      slug,
      parentId: parentId || null,
      description: description.trim() ? description : null,
      imageUrl,
      sortOrder: sort,
      active,
      seoTitle: seoTitle.trim() || null,
      seoDescription: seoDescription.trim() || null,
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormError message={problem ?? (save.error ? errorMessage(save.error) : null)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Name"
          required
          maxLength={120}
          value={name}
          autoFocus
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
          hint={<>Shown as /category/{slug || "…"}</>}
        />
        <SelectField label="Parent category" value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">None (top-level department)</option>
          {categoryOptions(categories, c?.id).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Sort order"
          type="number"
          step={1}
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          hint="Lower numbers are listed first."
        />
      </div>
      <TextAreaField
        label="Description (optional)"
        rows={3}
        maxLength={5000}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        hint="Shown at the top of the category page."
      />
      <ImageInput label="Category image" value={imageUrl} onChange={setImageUrl} hint="Square images work best, at least 600 × 600 pixels." />
      <Checkbox label="Visible in the shop" checked={active} onChange={(e) => setActive(e.target.checked)} />
      <div className="grid gap-4 border-t border-galv pt-4 sm:grid-cols-2">
        <TextField
          label="Page title for Google (optional)"
          maxLength={70}
          value={seoTitle}
          onChange={(e) => setSeoTitle(e.target.value)}
          hint={`${seoTitle.length} of 70 characters`}
        />
        <TextField
          label="Description for Google (optional)"
          maxLength={170}
          value={seoDescription}
          onChange={(e) => setSeoDescription(e.target.value)}
          hint={`${seoDescription.length} of 170 characters`}
        />
      </div>
      <FormActions className="justify-end">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {c ? "Save changes" : "Create category"}
        </Button>
      </FormActions>
    </form>
  );
}
