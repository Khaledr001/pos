"use client";

import type { AdminBrand, AdminCategory, AdminProductDetail } from "@al-lahiq/api-client";
import { useMutation } from "@tanstack/react-query";
import { ExternalLink, Plus } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Checkbox, FormError, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { adminApi, errorMessage } from "@/lib/api-browser";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { categoryOptions, rowKey } from "../catalog-helpers";
import { useAdminQuery, useInvalidate, useSetAdminData } from "../data";
import { slugify } from "../helpers";
import { MarkdownEditor } from "../markdown-editor";
import { move, RowControls, useUnsavedWarning } from "../row-controls";
import { useToast } from "../toast";
import { ErrorState, Loading, Notice, PageHeader, Panel } from "../ui";
import { ProductDocuments, ProductImages } from "./product-media";
import { ProductLinks } from "./product-links";
import { PosPanel } from "./pos-panel";

export function ProductEditor({ id }: { id: string }) {
  const path = `/admin/products/${id}`;
  const product = useAdminQuery<AdminProductDetail>(path);
  const brands = useAdminQuery<AdminBrand[]>("/admin/brands");
  const categories = useAdminQuery<AdminCategory[]>("/admin/categories");

  const error = product.error ?? brands.error ?? categories.error;
  if (error)
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          void product.refetch();
          void brands.refetch();
          void categories.refetch();
        }}
      />
    );
  if (!product.data || !brands.data || !categories.data) return <Loading label="Loading product" />;

  const p = product.data;
  return (
    <>
      <PageHeader
        back={{ href: "/admin/products", label: "All products" }}
        title={p.name}
        meta={
          <>
            <Badge tone={p.published ? "pipe" : "neutral"}>{p.published ? "Published" : "Draft"}</Badge>
            <Badge tone={p.inStock ? "pipe" : "signal"}>{p.inStock ? "In stock" : "Out of stock"}</Badge>
            {p.featured && <Badge tone="brass">Featured</Badge>}
            <span>Last changed {formatDateTime(p.updatedAt)}</span>
          </>
        }
        actions={
          p.published && (
            <Link href={`/product/${p.slug}`} target="_blank" rel="noopener" className={buttonClass("secondary", "sm")}>
              <ExternalLink className="size-4" aria-hidden />
              View in shop
            </Link>
          )
        }
      />
      <div className="flex flex-col gap-4">
        <DetailsForm key={p.id} product={p} path={path} brands={brands.data} categories={categories.data} />
        <ProductImages key={`img-${p.id}`} product={p} path={path} />
        <ProductDocuments key={`doc-${p.id}`} product={p} path={path} />
        <ProductLinks key={`links-${p.id}`} product={p} path={path} />
        <PosPanel product={p} path={path} />
      </div>
    </>
  );
}

type Spec = { key: string; label: string; value: string };

type DetailsState = {
  name: string;
  slug: string;
  description: string;
  brandId: string;
  categoryId: string;
  pickupOnly: boolean;
  published: boolean;
  featured: boolean;
  specs: Spec[];
  seoTitle: string;
  seoDescription: string;
};

function readSpecs(specs: unknown): { label: string; value: string }[] {
  if (!Array.isArray(specs)) return [];
  return specs
    .filter((s): s is { label: unknown; value: unknown } => !!s && typeof s === "object")
    .map((s) => ({ label: String(s.label ?? ""), value: String(s.value ?? "") }));
}

function fromProduct(p: AdminProductDetail): DetailsState {
  return {
    name: p.name,
    slug: p.slug,
    description: p.description ?? "",
    brandId: p.brandId ?? "",
    categoryId: p.categoryId ?? "",
    pickupOnly: p.pickupOnly,
    published: p.published,
    featured: p.featured,
    specs: readSpecs(p.specs).map((s) => ({ ...s, key: rowKey() })),
    seoTitle: p.seoTitle ?? "",
    seoDescription: p.seoDescription ?? "",
  };
}

/** Comparable form of the state (row keys and whitespace don't count as changes). */
function comparable(s: DetailsState) {
  return JSON.stringify({ ...s, specs: s.specs.map((x) => [x.label.trim(), x.value.trim()]) });
}

function DetailsForm({
  product,
  path,
  brands,
  categories,
}: {
  product: AdminProductDetail;
  path: string;
  brands: AdminBrand[];
  categories: AdminCategory[];
}) {
  const toast = useToast();
  const setData = useSetAdminData();
  const invalidate = useInvalidate();
  const [form, setForm] = useState<DetailsState>(() => fromProduct(product));
  const [saved, setSaved] = useState(() => comparable(fromProduct(product)));
  const [problem, setProblem] = useState<string | null>(null);
  const dirty = comparable(form) !== saved;
  useUnsavedWarning(dirty);

  const set = <K extends keyof DetailsState>(key: K, value: DetailsState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setSpec = (i: number, patch: Partial<Spec>) =>
    setForm((f) => ({ ...f, specs: f.specs.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => adminApi.patch<AdminProductDetail>(path, body),
    onSuccess: (p) => {
      setData(path, p);
      void invalidate("/admin/products");
      const next = fromProduct(p);
      setForm(next);
      setSaved(comparable(next));
      toast(p.published && !product.published ? "Product published" : "Product details saved");
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const specs = form.specs
      .map((s) => ({ label: s.label.trim(), value: s.value.trim() }))
      .filter((s) => s.label || s.value);
    if (specs.some((s) => !s.label || !s.value)) {
      setProblem("Each spec row needs both a label and a value. Fill in the empty box or remove the row.");
      return;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug)) {
      setProblem("The web address can only use lowercase letters, numbers and single dashes.");
      return;
    }
    save.mutate({
      name: form.name.trim(),
      slug: form.slug,
      description: form.description.trim() ? form.description : null,
      brandId: form.brandId || null,
      categoryId: form.categoryId || null,
      pickupOnly: form.pickupOnly,
      published: form.published,
      featured: form.featured,
      specs,
      seoTitle: form.seoTitle.trim() || null,
      seoDescription: form.seoDescription.trim() || null,
    });
  };

  const noPrice = product.fromNetPriceFils == null;
  const noStock = !product.inStock;
  const publishing = form.published && !product.published;
  const contentGaps = [
    !form.description.trim() && "a description",
    !product.images.length && "photos",
    !form.categoryId && "a category",
  ].filter(Boolean) as string[];

  return (
    <form onSubmit={submit} noValidate>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title="What shoppers see" className="min-w-0">
          <div className="flex flex-col gap-4">
            <TextField label="Product name" required minLength={2} maxLength={300} value={form.name} onChange={(e) => set("name", e.target.value)} />
            <TextField
              label="Web address"
              value={form.slug}
              onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/\s+/g, "-"))}
              hint={
                <>
                  Shown as /product/<span className="font-mono">{form.slug || "…"}</span>. Changing it breaks links people have saved.{" "}
                  {form.slug !== slugify(form.name) && (
                    <button type="button" className="font-semibold text-pipe underline" onClick={() => set("slug", slugify(form.name))}>
                      Make it from the name
                    </button>
                  )}
                </>
              }
            />
            <MarkdownEditor
              label="Description"
              value={form.description}
              onChange={(v) => set("description", v)}
              maxLength={20000}
              rows={10}
            />

            <fieldset>
              <legend className="text-sm font-medium">Specifications</legend>
              <p className="text-sm text-steel">Shown as a table on the product page, e.g. “Material: brass”.</p>
              <div className="mt-2 flex flex-col gap-2">
                {form.specs.map((s, i) => (
                  <div key={s.key} className="flex items-center gap-2">
                    <input
                      aria-label={`Spec ${i + 1} label`}
                      placeholder="Label"
                      maxLength={80}
                      value={s.label}
                      onChange={(e) => setSpec(i, { label: e.target.value })}
                      className="h-10 w-2/5 min-w-0 rounded-[var(--radius-tag)] border border-galv bg-paper px-3 text-[15px] focus:border-pipe focus:outline-none focus:ring-2 focus:ring-pipe/20"
                    />
                    <input
                      aria-label={`Spec ${i + 1} value`}
                      placeholder="Value"
                      maxLength={300}
                      value={s.value}
                      onChange={(e) => setSpec(i, { value: e.target.value })}
                      className="h-10 min-w-0 flex-1 rounded-[var(--radius-tag)] border border-galv bg-paper px-3 text-[15px] focus:border-pipe focus:outline-none focus:ring-2 focus:ring-pipe/20"
                    />
                    <RowControls
                      index={i}
                      count={form.specs.length}
                      label={`spec ${i + 1}`}
                      onMove={(d) => set("specs", move(form.specs, i, d))}
                      onRemove={() => set("specs", form.specs.filter((_, j) => j !== i))}
                    />
                  </div>
                ))}
                {form.specs.length < 40 && (
                  <div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => set("specs", [...form.specs, { key: rowKey(), label: "", value: "" }])}
                    >
                      <Plus className="size-4" aria-hidden />
                      Add a spec row
                    </Button>
                  </div>
                )}
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-3 border-t border-galv pt-4">
              <legend className="sr-only">Search engines</legend>
              <p className="text-sm font-medium">Search engines (optional)</p>
              <TextField
                label="Page title for Google"
                maxLength={70}
                value={form.seoTitle}
                onChange={(e) => set("seoTitle", e.target.value)}
                placeholder={form.name}
                hint={`${form.seoTitle.length} of 70 characters. Leave empty to use the product name.`}
              />
              <TextAreaField
                label="Description for Google"
                maxLength={170}
                rows={2}
                value={form.seoDescription}
                onChange={(e) => set("seoDescription", e.target.value)}
                hint={`${form.seoDescription.length} of 170 characters. Leave empty to use the start of the description.`}
              />
            </fieldset>
          </div>
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title="In the shop">
            <div className="flex flex-col gap-3">
              <Checkbox label="Published (visible in the shop)" checked={form.published} onChange={(e) => set("published", e.target.checked)} />
              <Checkbox label="Featured on the home page" checked={form.featured} onChange={(e) => set("featured", e.target.checked)} />
              <Checkbox label="Store pickup only (too big to courier)" checked={form.pickupOnly} onChange={(e) => set("pickupOnly", e.target.checked)} />
              {form.published && (noPrice || noStock) && (
                <Notice tone={noPrice ? "danger" : "warning"} title={publishing ? "Check before publishing" : "Shoppers can't buy this yet"}>
                  {noPrice && "This product has no price from the POS, so it can't be added to a cart. "}
                  {noStock && "It is out of stock at every branch. "}
                  {noPrice ? "Set the price in the POS first." : "Shoppers will see it as out of stock until the POS sends new stock."}
                </Notice>
              )}
              {publishing && contentGaps.length > 0 && (
                <Notice tone="info" title="Still missing">
                  It has no {contentGaps.join(", ")}. You can publish now and add them later.
                </Notice>
              )}
            </div>
          </Panel>
          <Panel title="Organise">
            <div className="flex flex-col gap-4">
              <SelectField label="Brand" value={form.brandId} onChange={(e) => set("brandId", e.target.value)}>
                <option value="">No brand</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.active ? "" : " (hidden)"}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Category"
                value={form.categoryId}
                onChange={(e) => set("categoryId", e.target.value)}
                hint={!form.categoryId ? "Shoppers find products by browsing categories." : undefined}
              >
                <option value="">No category</option>
                {categoryOptions(categories).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </SelectField>
            </div>
          </Panel>
        </div>
      </div>

      <div
        className={cn(
          "sticky bottom-0 z-20 mt-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-panel)] border px-4 py-3 shadow-[0_-4px_16px_rgba(28,37,48,0.06)]",
          dirty ? "border-brass/50 bg-brass-tint" : "border-galv bg-paper",
        )}
      >
        <div className="min-w-0 flex-1">
          <FormError message={problem ?? (save.error ? errorMessage(save.error) : null)} />
          {!problem && !save.error && (
            <p className="text-sm text-steel">{dirty ? "You have unsaved changes to the product details." : "Product details are saved."}</p>
          )}
        </div>
        {dirty && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setForm(fromProduct(product));
              setProblem(null);
              save.reset();
            }}
          >
            Discard changes
          </Button>
        )}
        <Button type="submit" loading={save.isPending} disabled={!dirty || form.name.trim().length < 2}>
          {publishing ? "Save and publish" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
