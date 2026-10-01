"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, Package, Pencil, RefreshCw, Search, Upload } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { usePermission } from "@/lib/require-auth";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Loading, Notice, PageHeader, errorText, textareaClass } from "../shared";

interface ListingRow {
  productId: string;
  sku: string;
  name: string;
  imageUrl: string | null;
  isActive: boolean;
  brandName: string | null;
  categoryName: string | null;
  listing: { slug: string; isPublished: boolean; isFeatured: boolean; pickupOnly: boolean } | null;
}

interface ListingDetail {
  product: { id: string; sku: string; name: string; description: string | null };
  listing: {
    slug: string;
    isPublished: boolean;
    isFeatured: boolean;
    pickupOnly: boolean;
    seoTitle: string | null;
    seoDescription: string | null;
    specs: { label: string; value: string }[];
    documents: { title: string; url: string; kind: string }[];
  } | null;
  suggestedSlug: string;
}

interface Form {
  slug: string;
  isPublished: boolean;
  isFeatured: boolean;
  pickupOnly: boolean;
  seoTitle: string;
  seoDescription: string;
  /** One "Label: value" per line — quicker to type than a grid. */
  specs: string;
  /** One "Title | https://… | kind" per line. */
  documents: string;
}

const STATUSES = [
  ["all", "All products"],
  ["published", "On the website"],
  ["unpublished", "Hidden"],
  ["unlisted", "Never listed"],
] as const;

export default function ListingsPage() {
  const { tokens } = useAuth();
  const mayWrite = usePermission("storefront:write");
  const auth = { accessToken: tokens?.accessToken };

  const [rows, setRows] = useState<ListingRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("all");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [editing, setEditing] = useState<ListingDetail | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const PAGE_SIZE = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ items: ListingRow[]; total: number }>("/storefront-admin/listings", {
        ...auth,
        query: { page, pageSize: PAGE_SIZE, status, ...(q.trim() ? { q: q.trim() } : {}) },
      });
      setRows(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(errorText(err, "Failed to load products."));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens, page, status, q]);

  useEffect(() => {
    void load();
  }, [load]);

  async function edit(productId: string) {
    setError(null);
    try {
      const detail = await api.get<ListingDetail>(`/storefront-admin/listings/${productId}`, auth);
      const l = detail.listing;
      setEditing(detail);
      setForm({
        slug: l?.slug ?? detail.suggestedSlug,
        isPublished: l?.isPublished ?? true,
        isFeatured: l?.isFeatured ?? false,
        pickupOnly: l?.pickupOnly ?? false,
        seoTitle: l?.seoTitle ?? "",
        seoDescription: l?.seoDescription ?? "",
        specs: (l?.specs ?? []).map((s) => `${s.label}: ${s.value}`).join("\n"),
        documents: (l?.documents ?? []).map((d) => `${d.title} | ${d.url} | ${d.kind}`).join("\n"),
      });
    } catch (err) {
      setError(errorText(err, "Failed to load the product."));
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || !form) return;
    setSaving(true);
    setError(null);
    try {
      await api.put(
        `/storefront-admin/listings/${editing.product.id}`,
        {
          slug: form.slug,
          isPublished: form.isPublished,
          isFeatured: form.isFeatured,
          pickupOnly: form.pickupOnly,
          seoTitle: form.seoTitle.trim() || null,
          seoDescription: form.seoDescription.trim() || null,
          specs: form.specs
            .split("\n")
            .map((line) => line.split(":"))
            .filter((parts) => parts.length >= 2 && parts[0]!.trim())
            .map(([label, ...value]) => ({ label: label!.trim(), value: value.join(":").trim() })),
          documents: form.documents
            .split("\n")
            .map((line) => line.split("|").map((p) => p.trim()))
            .filter((parts) => parts.length >= 2 && parts[0] && parts[1])
            .map(([title, url, kind]) => ({ title, url, kind: kind || "datasheet" })),
        },
        auth,
      );
      setSuccess(`${editing.product.name} saved.`);
      setEditing(null);
      void load();
    } catch (err) {
      setError(errorText(err, "Could not save the listing."));
    } finally {
      setSaving(false);
    }
  }

  async function togglePublished(row: ListingRow) {
    if (!row.listing) return void edit(row.productId);
    try {
      if (row.listing.isPublished) {
        await api.post("/storefront-admin/listings/unpublish", { productIds: [row.productId] }, auth);
      } else {
        const detail = await api.get<ListingDetail>(`/storefront-admin/listings/${row.productId}`, auth);
        const l = detail.listing!;
        await api.put(`/storefront-admin/listings/${row.productId}`, { ...l, isPublished: true }, auth);
      }
      void load();
    } catch (err) {
      setError(errorText(err, "Could not change that listing."));
    }
  }

  async function publishAll() {
    if (!window.confirm("List and publish every active product that has never been listed?")) return;
    try {
      const res = await api.post<{ published: number }>("/storefront-admin/listings/publish-all", {}, auth);
      setSuccess(`${res.published} product(s) published.`);
      void load();
    } catch (err) {
      setError(errorText(err, "Bulk publish failed."));
    }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Website Listings"
        description="Which products are sold online and how they look there. Names, prices and stock stay the POS's own."
      >
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
        </Button>
        {mayWrite && (
          <Button size="sm" onClick={() => void publishAll()}>
            <Upload className="h-4 w-4" /> Publish all unlisted
          </Button>
        )}
      </PageHeader>

      {success && <Notice kind="success" message={success} onClose={() => setSuccess(null)} />}
      {error && !editing && <Notice kind="error" message={error} onClose={() => setError(null)} />}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Name or SKU" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <div className="flex flex-wrap gap-2">
          {STATUSES.map(([value, label]) => (
            <button
              key={value}
              onClick={() => { setStatus(value); setPage(1); }}
              className={cn(
                "rounded-full border px-3 py-1 text-xs cursor-pointer",
                status === value ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <Loading label="Loading products..." />
        ) : rows.length === 0 ? (
          <div className="py-16 text-center">
            <Package className="mx-auto h-12 w-12 text-muted-foreground/30" />
            <h3 className="mt-4 text-sm font-semibold text-foreground">Nothing here</h3>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3.5 font-medium">Product</th>
                  <th className="px-4 py-3.5 font-medium">Web address</th>
                  <th className="px-4 py-3.5 font-medium">Flags</th>
                  <th className="px-4 py-3.5 text-center font-medium">On website</th>
                  <th className="px-4 py-3.5 text-right font-medium">Edit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.productId} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3.5">
                      <div className="font-medium text-foreground">{r.name}</div>
                      <div className="text-muted-foreground">
                        <span className="font-mono">{r.sku}</span>
                        {r.brandName ? ` · ${r.brandName}` : ""}
                        {r.categoryName ? ` · ${r.categoryName}` : ""}
                        {!r.isActive && " · inactive in the POS"}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-muted-foreground">{r.listing ? `/product/${r.listing.slug}` : "—"}</td>
                    <td className="px-4 py-3.5 space-x-1">
                      {r.listing?.isFeatured && <Badge variant="warning">Featured</Badge>}
                      {r.listing?.pickupOnly && <Badge variant="secondary">Pickup only</Badge>}
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <button
                        disabled={!mayWrite}
                        onClick={() => void togglePublished(r)}
                        className="cursor-pointer disabled:cursor-default"
                        aria-label={r.listing?.isPublished ? "Hide from the website" : "Show on the website"}
                      >
                        {r.listing?.isPublished ? <Eye className="mx-auto h-4 w-4 text-emerald-500" /> : <EyeOff className="mx-auto h-4 w-4 text-muted-foreground" />}
                      </button>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      {mayWrite && (
                        <button onClick={() => void edit(r.productId)} className="cursor-pointer text-muted-foreground hover:text-foreground" aria-label={`Edit ${r.name}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="text-muted-foreground">Page {page} of {pages}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          {editing && form && (
            <>
              <DialogHeader>
                <DialogTitle>{editing.product.name}</DialogTitle>
                <DialogDescription>How this product appears online. Price and stock come from the POS.</DialogDescription>
              </DialogHeader>
              {error && <Notice kind="error" message={error} onClose={() => setError(null)} />}
              <form onSubmit={save} className="space-y-4">
                <Field label="Web address" hint={`/product/${form.slug || "…"}`}>
                  <Input required value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
                </Field>
                <div className="flex flex-wrap gap-4 text-xs">
                  {([
                    ["isPublished", "Show on the website"],
                    ["isFeatured", "Featured on the home page"],
                    ["pickupOnly", "Pickup only (too heavy for courier)"],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 font-medium text-foreground">
                      <input type="checkbox" className="h-4 w-4 rounded border-input" checked={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />
                      {label}
                    </label>
                  ))}
                </div>
                <Field label="SEO title"><Input value={form.seoTitle} onChange={(e) => setForm({ ...form, seoTitle: e.target.value })} /></Field>
                <Field label="SEO description">
                  <textarea rows={2} className={textareaClass} value={form.seoDescription} onChange={(e) => setForm({ ...form, seoDescription: e.target.value })} />
                </Field>
                <Field label="Specifications" hint="One per line, e.g. Material: Brass">
                  <textarea rows={4} className={textareaClass} value={form.specs} onChange={(e) => setForm({ ...form, specs: e.target.value })} />
                </Field>
                <Field label="Documents" hint="One per line: Title | https://link | datasheet">
                  <textarea rows={3} className={textareaClass} value={form.documents} onChange={(e) => setForm({ ...form, documents: e.target.value })} />
                </Field>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                  <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save listing"}</Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
