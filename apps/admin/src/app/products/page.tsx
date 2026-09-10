"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Package, Search, Plus, RefreshCw, X, AlertCircle, CheckCircle2, Boxes, Trash2,
  Pencil, Image as ImageIcon, Upload, Star, FileUp, Layers,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetTitle,
  SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ── Types ──────────────────────────────────────────────────────────────────

interface ProductVariant {
  id: string;
  sku: string;
  barcode: string | null;
  variantName: string;
  isActive: boolean;
  prices?: { sellingPrice: string; wholesalePrice?: string }[];
  /** Present on GET /products/:id — base-unit quantity on hand. */
  stock?: string;
  minStock?: string;
  sellingPrice?: string;
  minSellingPrice?: string | null;
  /** Only present when the requesting user holds canViewCost. */
  purchasePrice?: string | null;
}

interface Product {
  id: string;
  name: string;
  sku: string;
  description?: string | null;
  isActive: boolean;
  categoryId?: string;
  categoryName?: string;
  brandId?: string | null;
  brandName?: string;
  unitAbbr?: string;
  variantCount?: number;
  hasVariants?: boolean;
  minPrice?: string | null;
  maxPrice?: string | null;
  unit?: { name: string };
  category?: { name: string } | null;
  taxRate?: number;
  variants?: ProductVariant[];
  images?: ProductImage[];
}

interface ProductImage {
  id: string;
  url: string;
  isPrimary: boolean;
  altText: string | null;
}

interface Brand {
  id: string;
  name: string;
}

interface ProductsPage {
  items: Product[];
  meta?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  total?: number;
  page?: number;
  limit?: number;
}

interface Unit {
  id: string;
  name: string;
  abbreviation?: string;
}

interface VariantUnit {
  id: string;
  unitId: string;
  unitName: string;
  unitAbbr: string;
  /** Base units per pack, as a decimal string — "20" for a box of 20. */
  conversionFactor: string;
  barcode: string | null;
  /** Flat price for the pack. null = base price x conversionFactor. */
  priceOverride: string | null;
  /** Offered in the POS unit picker. */
  isSellable: boolean;
  /** Offered when raising a purchase order or receiving goods. */
  isPurchasable: boolean;
}

interface Category {
  id: string;
  name: string;
  children?: Category[];
}

// ── Create a new unit of measure inline ─────────────────────────────────────

function NewUnitDialog({
  accessToken,
  onCreated,
}: {
  accessToken?: string;
  onCreated: (unit: Unit) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [abbreviation, setAbbreviation] = useState("");
  const [allowsFractions, setAllowsFractions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const unit = await api.post<Unit>(
        "/units",
        { name, abbreviation, allowsFractions },
        { accessToken },
      );
      onCreated(unit);
      setOpen(false);
      setName("");
      setAbbreviation("");
      setAllowsFractions(false);
    } catch (err: any) {
      setError(err?.message || "Failed to create the unit.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setError(null); setOpen(true); }}
        className="text-[11px] font-medium text-primary hover:underline cursor-pointer"
      >
        + New unit
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New Unit of Measure</DialogTitle>
            <DialogDescription>e.g. Box, Roll, Kilogram — for selling or buying in a different packaging.</DialogDescription>
          </DialogHeader>

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" /><span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Name *</label>
              <Input required maxLength={50} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Roll" />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Abbreviation *</label>
              <Input
                required
                maxLength={10}
                value={abbreviation}
                onChange={(e) => setAbbreviation(e.target.value)}
                placeholder="e.g. roll"
                className="font-mono"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={allowsFractions}
                onChange={(e) => setAllowsFractions(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Allows fractional quantities (e.g. 5.5 metres)
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>{submitting ? "Creating…" : "Create unit"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Flatten category tree for a <select> ────────────────────────────────────

function flattenCategories(cats: Category[], depth = 0): { id: string; label: string }[] {
  const result: { id: string; label: string }[] = [];
  for (const c of cats) {
    result.push({ id: c.id, label: "  ".repeat(depth) + c.name });
    if (c.children?.length) result.push(...flattenCategories(c.children, depth + 1));
  }
  return result;
}

// ── Page numbers with ellipsis, e.g. [1, "…", 4, 5, 6, "…", 42] ─────────────

function paginationRange(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | "ellipsis")[] = [1];
  if (current > 3) pages.push("ellipsis");

  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) {
    pages.push(p);
  }

  if (current < total - 2) pages.push("ellipsis");
  pages.push(total);
  return pages;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const { tokens } = useAuth();

  // List state
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const LIMIT = 50;

  // Lookups
  const [units, setUnits] = useState<Unit[]>([]);
  const [categories, setCategories] = useState<{ id: string; label: string }[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);

  // Dialog
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Form state
  const [fName, setFName] = useState("");
  const [fSku, setFSku] = useState("");
  const [fUnitId, setFUnitId] = useState("");
  const [fCategoryId, setFCategoryId] = useState("");
  const [fSellingPrice, setFSellingPrice] = useState("");
  const [fPurchasePrice, setFPurchasePrice] = useState("");
  const [fWholesalePrice, setFWholesalePrice] = useState("");
  const [fOpeningStock, setFOpeningStock] = useState("0");
  const [fBranchId, setFBranchId] = useState("");
  const [branches, setBranches] = useState<{ id: string; name: string; code: string }[]>([]);

  // Packagings dialog
  const [packagingProduct, setPackagingProduct] = useState<Product | null>(null);

  // Edit dialog (includes image management)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Detail drawer, opened by clicking a row
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);

  // ── Fetch products ──────────────────────────────────────────────────────

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setActionError(null);
    try {
      const res = await api.get<any>("/products", {
        accessToken: tokens?.accessToken,
        query: { q: search || undefined, page, limit: LIMIT, includeInactive: false },
      });
      const list = Array.isArray(res) ? res : (res?.items ?? []);
      const totalCount = res?.meta?.total ?? res?.total ?? list.length;
      const pageCount = res?.meta?.totalPages ?? Math.max(1, Math.ceil(totalCount / LIMIT));
      setProducts(list);
      setTotal(totalCount);
      setTotalPages(pageCount);
      // A filter can shrink the result set out from under whatever page the
      // user was on (e.g. deleting the last row on the last page) — land them
      // on the new last page instead of showing an empty table.
      if (page > pageCount) setPage(pageCount);
    } catch (err: any) {
      console.error("Failed to fetch products:", err);
      setActionError(err?.message || "Failed to load products from API.");
    } finally {
      setLoading(false);
    }
  }, [tokens, search, page]);

  // ── Fetch lookups ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!tokens?.accessToken) return;

    Promise.allSettled([
      api.get<Unit[]>("/units", { accessToken: tokens.accessToken }),
      api.get<Category[]>("/categories", { accessToken: tokens.accessToken }),
      api.get<{ items: { id: string; name: string; code: string }[] }>("/branches", { accessToken: tokens.accessToken }),
      api.get<Brand[]>("/brands", { accessToken: tokens.accessToken }),
    ]).then(([unitsRes, catsRes, branchesRes, brandsRes]) => {
      if (unitsRes.status === "fulfilled") setUnits(unitsRes.value ?? []);
      if (catsRes.status === "fulfilled") setCategories(flattenCategories(catsRes.value ?? []));
      if (branchesRes.status === "fulfilled") {
        const bs = branchesRes.value?.items ?? [];
        setBranches(bs);
        if (bs.length > 0 && bs[0]) setFBranchId(bs[0].id);
      }
      if (brandsRes.status === "fulfilled") setBrands(brandsRes.value ?? []);
    });
  }, [tokens]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Debounce search
  useEffect(() => {
    setPage(1);
  }, [search]);

  // ── Handle create ───────────────────────────────────────────────────────

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fUnitId) { setActionError("Please select a unit of measure."); return; }
    if (!fSellingPrice) { setActionError("Selling price is required."); return; }

    setSubmitting(true);
    setActionError(null);

    try {
      await api.post(
        "/products",
        {
          name: fName,
          sku: fSku || undefined,
          unitId: fUnitId,
          categoryId: fCategoryId || undefined,
          variants: [
            {
              variantName: "Default",
              sellingPrice: parseFloat(fSellingPrice),
              purchasePrice: fPurchasePrice ? parseFloat(fPurchasePrice) : 0,
              wholesalePrice: fWholesalePrice ? parseFloat(fWholesalePrice) : undefined,
              openingStock: fOpeningStock ? parseFloat(fOpeningStock) : undefined,
              openingStockBranchId: fOpeningStock && parseFloat(fOpeningStock) > 0 && fBranchId ? fBranchId : undefined,
            },
          ],
        },
        { accessToken: tokens?.accessToken },
      );

      setActionSuccess(`Product "${fName}" created successfully.`);
      setIsModalOpen(false);
      // Reset form
      setFName(""); setFSku(""); setFUnitId(""); setFCategoryId("");
      setFSellingPrice(""); setFPurchasePrice(""); setFWholesalePrice(""); setFOpeningStock("0");
      fetchProducts();
    } catch (err: any) {
      setActionError(err?.message || "Failed to create product.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Handle delete ───────────────────────────────────────────────────────

  async function handleDelete(product: Product) {
    if (!window.confirm(`Delete "${product.name}"? A product with sales history is deactivated instead.`)) {
      return;
    }
    setActionError(null);
    try {
      await api.delete(`/products/${product.id}`, { accessToken: tokens?.accessToken });
      setActionSuccess(`"${product.name}" removed.`);
      await fetchProducts();
    } catch (err: any) {
      setActionError(err?.message || "Failed to delete the product.");
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Product Catalogue</h1>
            {total > 0 && (
              <Badge variant="secondary">{total.toLocaleString()} SKUs</Badge>
            )}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Multi-unit catalogue for Hardware, Electrical, Sanitary, and Paint retail with wholesale tier pricing.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Button variant="outline" size="sm" onClick={fetchProducts} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/products/import">
              <FileUp className="h-4 w-4" />
              Import
            </Link>
          </Button>
          <Button size="sm" onClick={() => { setActionError(null); setIsModalOpen(true); }}>
            <Plus className="h-4 w-4" />
            Add Product
          </Button>
        </div>
      </div>

      {/* Notifications */}
      {actionSuccess && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400">
          <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /><span>{actionSuccess}</span></div>
          <button onClick={() => setActionSuccess(null)} className="cursor-pointer"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {actionError && (
        <div className="flex items-center justify-between rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <div className="flex items-center gap-2"><AlertCircle className="h-4 w-4" /><span>{actionError}</span></div>
          <button onClick={() => setActionError(null)} className="cursor-pointer"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by product name, SKU, or barcode..."
          className="pl-10 h-10 bg-secondary/30"
        />
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            <div className="h-6 w-6 mx-auto mb-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Loading products from API...
          </div>
        ) : products.length === 0 ? (
          <div className="py-16 text-center">
            <Package className="mx-auto h-12 w-12 text-muted-foreground/30" />
            <h3 className="mt-4 text-sm font-semibold text-foreground">No products found</h3>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {search ? "No products match your search." : "Add your first product to get started."}
            </p>
            {!search && (
              <Button size="sm" onClick={() => setIsModalOpen(true)} className="mt-4">
                <Plus className="h-3.5 w-3.5" /> Add Product
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3.5 font-medium">SKU</th>
                  <th className="px-4 py-3.5 font-medium">Product Name</th>
                  <th className="px-4 py-3.5 font-medium">Category</th>
                  <th className="px-4 py-3.5 font-medium">Unit</th>
                  <th className="px-4 py-3.5 text-right font-medium">Price (AED)</th>
                  <th className="px-4 py-3.5 text-center font-medium">Variants</th>
                  <th className="px-4 py-3.5 text-center font-medium">Status</th>
                  <th className="px-4 py-3.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {products.map((product) => {
                  const catName = product.categoryName || product.category?.name;
                  const unitName = product.unitAbbr || product.unit?.name || "pcs";
                  const priceDisplay = product.minPrice
                    ? product.minPrice === product.maxPrice
                      ? parseFloat(product.minPrice).toFixed(2)
                      : `${parseFloat(product.minPrice).toFixed(2)} – ${parseFloat(product.maxPrice || "0").toFixed(2)}`
                    : "—";

                  return (
                    <tr
                      key={product.id}
                      onDoubleClick={() => setViewingProduct(product)}
                      title="Double-click to view details"
                      className="cursor-pointer hover:bg-secondary/30 transition-colors"
                    >
                      <td className="px-4 py-3.5 font-mono font-bold text-primary">{product.sku}</td>
                      <td className="px-4 py-3.5 font-medium text-foreground max-w-xs">
                        <div className="truncate font-semibold">{product.name}</div>
                        {product.brandName && (
                          <div className="text-[11px] text-muted-foreground font-normal">{product.brandName}</div>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        {catName ? (
                          <Badge variant="secondary" className="text-[10px]">{catName}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-muted-foreground font-mono text-[11px] uppercase">{unitName}</td>
                      <td className="px-4 py-3.5 text-right font-mono font-semibold text-foreground">
                        {priceDisplay !== "—" ? `AED ${priceDisplay}` : "—"}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <Badge variant="outline" className="text-[10px] font-medium">
                          {product.variantCount ?? 1} {product.variantCount === 1 ? "variant" : "variants"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <Badge variant={product.isActive ? "success" : "secondary"}>
                          {product.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {/* One stopPropagation for the whole action cluster, rather than
                            one per button — a click (or two quick ones) here should never
                            also open the row's detail drawer underneath it. */}
                        <div
                          className="flex items-center justify-end gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                        >
                          <Button variant="outline" size="sm" onClick={() => setPackagingProduct(product)}>
                            <Boxes className="h-3.5 w-3.5" />
                          </Button>
                          <button
                            type="button"
                            onClick={() => setEditingProduct(product)}
                            aria-label={`Edit ${product.name}`}
                            className="cursor-pointer p-1.5 text-muted-foreground hover:text-foreground"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(product)}
                            aria-label={`Delete ${product.name}`}
                            className="cursor-pointer p-1.5 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs text-muted-foreground">
              Showing {((page - 1) * LIMIT) + 1}–{Math.min(page * LIMIT, total)} of {total.toLocaleString()} · Page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline" size="sm" disabled={page === 1}
                onClick={() => setPage(1)} aria-label="First page"
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline" size="sm" disabled={page === 1}
                onClick={() => setPage((p) => p - 1)} aria-label="Previous page"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              {paginationRange(page, totalPages).map((p, i) =>
                p === "ellipsis" ? (
                  <span key={`e-${i}`} className="px-1.5 text-xs text-muted-foreground">…</span>
                ) : (
                  <Button
                    key={p}
                    variant={p === page ? "default" : "outline"}
                    size="sm"
                    className="min-w-8 px-0 font-mono"
                    onClick={() => setPage(p)}
                    aria-label={`Page ${p}`}
                    aria-current={p === page ? "page" : undefined}
                  >
                    {p}
                  </Button>
                ),
              )}
              <Button
                variant="outline" size="sm" disabled={page === totalPages}
                onClick={() => setPage((p) => p + 1)} aria-label="Next page"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline" size="sm" disabled={page === totalPages}
                onClick={() => setPage(totalPages)} aria-label="Last page"
              >
                <ChevronsRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Add Product Dialog */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-blue-500 to-indigo-600 text-white">
                <Package className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle>Add New Product</DialogTitle>
                <DialogDescription>Creates a product with one default variant</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {actionError && (
            <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" /><span>{actionError}</span>
            </div>
          )}

          <form onSubmit={handleCreate} className="space-y-4">
            {/* Product Info */}
            <div className="rounded-xl border border-border p-4 space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Product Details</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-foreground mb-1.5">Product Name *</label>
                  <Input required value={fName} onChange={e => setFName(e.target.value)} placeholder="e.g. Ducab 3-Core 2.5mm² Flexible Cable" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">SKU (auto-generated if blank)</label>
                  <Input value={fSku} onChange={e => setFSku(e.target.value)} placeholder="e.g. EL-CBL-3CX25" className="font-mono" />
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="block text-xs font-medium text-foreground">Unit of Measure *</label>
                    <NewUnitDialog
                      accessToken={tokens?.accessToken}
                      onCreated={(u) => { setUnits((prev) => [...prev, u]); setFUnitId(u.id); }}
                    />
                  </div>
                  <Select value={fUnitId} onValueChange={setFUnitId}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="— Select Unit —" />
                    </SelectTrigger>
                    <SelectContent>
                      {units.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name}{u.abbreviation ? ` (${u.abbreviation})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Category</label>
                  <Select value={fCategoryId || "none"} onValueChange={(val) => setFCategoryId(val === "none" ? "" : val)}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="— No category —" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— No category —</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Pricing */}
            <div className="rounded-xl border border-border p-4 space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pricing (AED)</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Retail Price *</label>
                  <Input required type="number" min="0" step="0.01" value={fSellingPrice} onChange={e => setFSellingPrice(e.target.value)} placeholder="0.00" className="font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Purchase / Cost Price</label>
                  <Input type="number" min="0" step="0.01" value={fPurchasePrice} onChange={e => setFPurchasePrice(e.target.value)} placeholder="0.00" className="font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Wholesale Price</label>
                  <Input type="number" min="0" step="0.01" value={fWholesalePrice} onChange={e => setFWholesalePrice(e.target.value)} placeholder="0.00" className="font-mono" />
                </div>
              </div>
            </div>

            {/* Opening Stock */}
            <div className="rounded-xl border border-border p-4 space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Opening Stock (optional)</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Quantity</label>
                  <Input type="number" min="0" step="1" value={fOpeningStock} onChange={e => setFOpeningStock(e.target.value)} placeholder="0" className="font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Assign to Branch</label>
                  <Select value={fBranchId || "none"} onValueChange={(val) => setFBranchId(val === "none" ? "" : val)}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="— Select Branch —" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Select Branch —</SelectItem>
                      {branches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name} ({b.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving..." : "Create Product"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <PackagingsDialog
        product={packagingProduct}
        units={units}
        accessToken={tokens?.accessToken}
        onClose={() => setPackagingProduct(null)}
        onUnitCreated={(u) => setUnits((prev) => [...prev, u])}
      />

      <EditProductDialog
        product={editingProduct}
        categories={categories}
        brands={brands}
        accessToken={tokens?.accessToken}
        onClose={() => setEditingProduct(null)}
        onSaved={() => {
          setActionSuccess("Product updated.");
          fetchProducts();
        }}
      />

      <ProductDetailDrawer
        product={viewingProduct}
        accessToken={tokens?.accessToken}
        onClose={() => setViewingProduct(null)}
        onEdit={(product) => {
          setViewingProduct(null);
          setEditingProduct(product);
        }}
        onPackagings={(product) => {
          setViewingProduct(null);
          setPackagingProduct(product);
        }}
      />

      {/* <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        file={importFile}
        setFile={setImportFile}
        branchId={importBranchId}
        setBranchId={setImportBranchId}
        branches={branches}
        running={importRunning}
        setRunning={setImportRunning}
        result={importResult}
        setResult={setImportResult}
        fileInputRef={importFileRef}
        onSuccess={() => {
          setActionSuccess("Products imported successfully.");
          fetchProducts();
        }}
        tokens={tokens}
      /> */}
    </div>
  );
}

// ── Edit product (details + images) ─────────────────────────────────────────

/**
 * Product-level fields only — sku and unitId are fixed at creation
 * (products.service.ts's own update() never touches them either), and
 * variant/price editing lives in the pricing module's own surface (Stage
 * 5.1), not here. Images are managed inline: upload, set primary, remove.
 */
function EditProductDialog({
  product,
  categories,
  brands,
  accessToken,
  onClose,
  onSaved,
}: {
  product: Product | null;
  categories: { id: string; label: string }[];
  brands: Brand[];
  accessToken?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fName, setFName] = useState("");
  const [fDescription, setFDescription] = useState("");
  const [fCategoryId, setFCategoryId] = useState("");
  const [fBrandId, setFBrandId] = useState("");
  const [fTaxRate, setFTaxRate] = useState("");
  const [fIsActive, setFIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [images, setImages] = useState<ProductImage[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fetchImages = useCallback(async (productId: string) => {
    setImagesLoading(true);
    try {
      const rows = await api.get<ProductImage[]>(`/products/${productId}/images`, { accessToken });
      setImages(rows ?? []);
    } catch (err: any) {
      setError(err?.message || "Failed to load images.");
    } finally {
      setImagesLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (!product) return;
    setError(null);
    setFName(product.name);
    setFDescription(product.description ?? "");
    setFCategoryId(product.categoryId ?? "");
    setFBrandId(product.brandId ?? "");
    setFTaxRate(product.taxRate !== undefined && product.taxRate !== null ? String(product.taxRate) : "");
    setFIsActive(product.isActive);
    void fetchImages(product.id);
  }, [product, fetchImages]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!product) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.patch(
        `/products/${product.id}`,
        {
          name: fName,
          description: fDescription || undefined,
          categoryId: fCategoryId || null,
          brandId: fBrandId || null,
          taxRate: fTaxRate ? Number(fTaxRate) : undefined,
          isActive: fIsActive,
        },
        { accessToken },
      );
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to save the product.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpload(file: File) {
    if (!product) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("isPrimary", String(images.length === 0));
      await api.postForm(`/products/${product.id}/images`, form, { accessToken });
      await fetchImages(product.id);
    } catch (err: any) {
      setError(err?.message || "Failed to upload the image.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSetPrimary(image: ProductImage) {
    if (!product) return;
    setError(null);
    try {
      await api.patch(`/products/images/${image.id}`, { isPrimary: true }, { accessToken });
      await fetchImages(product.id);
    } catch (err: any) {
      setError(err?.message || "Failed to set the primary image.");
    }
  }

  async function handleRemoveImage(image: ProductImage) {
    if (!product) return;
    setError(null);
    try {
      await api.delete(`/products/images/${image.id}`, { accessToken });
      await fetchImages(product.id);
    } catch (err: any) {
      setError(err?.message || "Failed to remove the image.");
    }
  }

  return (
    <Dialog open={product !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-blue-500 to-indigo-600 text-white">
              <Pencil className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle>Edit {product?.name}</DialogTitle>
              <DialogDescription>SKU {product?.sku} — variant pricing lives on the Pricing screen.</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" /><span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4">
          <div className="rounded-xl border border-border p-4 space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Product Details</p>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Product Name *</label>
              <Input required value={fName} onChange={(e) => setFName(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Description</label>
              <textarea
                value={fDescription}
                onChange={(e) => setFDescription(e.target.value)}
                rows={2}
                className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Category</label>
                <Select value={fCategoryId || "none"} onValueChange={(val) => setFCategoryId(val === "none" ? "" : val)}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="— None —" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Brand</label>
                <Select value={fBrandId || "none"} onValueChange={(val) => setFBrandId(val === "none" ? "" : val)}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="— None —" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {brands.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Tax Rate % (blank = default)</label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={fTaxRate}
                  onChange={(e) => setFTaxRate(e.target.value)}
                  className="font-mono"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs font-medium text-foreground">
              <input
                type="checkbox"
                checked={fIsActive}
                onChange={(e) => setFIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Active
            </label>
          </div>

          <div className="rounded-xl border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Photos</p>
              <label className="cursor-pointer">
                <span className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border border-input px-2.5 py-1.5 text-xs font-medium hover:bg-secondary/50",
                  uploading && "opacity-50 pointer-events-none",
                )}>
                  <Upload className="h-3.5 w-3.5" />
                  {uploading ? "Uploading…" : "Upload"}
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleUpload(file);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>

            {imagesLoading ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : images.length === 0 ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <ImageIcon className="h-4 w-4" /> No photos yet. JPEG, PNG or WebP, up to 5MB.
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
                {images.map((image) => (
                  <div key={image.id} className="group relative aspect-square overflow-hidden rounded-lg border border-border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.url} alt={image.altText ?? ""} className="h-full w-full object-cover" />
                    {image.isPrimary && (
                      <span className="absolute left-1 top-1 rounded-full bg-primary p-1 text-primary-foreground">
                        <Star className="h-2.5 w-2.5 fill-current" />
                      </span>
                    )}
                    <div className="absolute inset-0 hidden items-center justify-center gap-1.5 bg-black/60 group-hover:flex">
                      {!image.isPrimary && (
                        <button
                          type="button"
                          onClick={() => void handleSetPrimary(image)}
                          aria-label="Set as primary photo"
                          className="cursor-pointer rounded-full bg-white/90 p-1.5 text-foreground hover:bg-white"
                        >
                          <Star className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleRemoveImage(image)}
                        aria-label="Remove photo"
                        className="cursor-pointer rounded-full bg-white/90 p-1.5 text-destructive hover:bg-white"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Product Detail Drawer ────────────────────────────────────────────────────

/**
 * Cascades a section in shortly after the one before it, rather than every
 * section appearing at once — reads as considered rather than as everything
 * just being dumped on screen the instant the drawer stops sliding.
 */
function Reveal({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <div
      // fade-in-up is a real animation this project defines in globals.css.
      // The tailwindcss-animate names (`animate-in`, `slide-in-from-bottom-2`)
      // that were here emit no CSS — that plugin isn't installed on Tailwind v4.
      className="animate-fade-in-up"
      // Delay tracks the panel's own 0.3s slide so sections cascade in as it
      // finishes its approach, rather than racing ahead of it mid-slide.
      style={{ animationDelay: `${180 + index * 70}ms`, animationDuration: "300ms" }}
    >
      {children}
    </div>
  );
}

/**
 * A read-only, everything-in-one-place view of a product: opened by
 * double-clicking its row (a single click is too easy to trigger by
 * accident while scanning the table). Category/brand/unit labels come from
 * the row data passed in (the list endpoint already resolved those names)
 * rather than from a fresh lookup — GET /products/:id itself only returns
 * the raw ids for those, not their names. Variants, images, description and
 * per-variant packagings are fetched fresh on open, since the list row never
 * carries those.
 *
 * Both the row data and the fetched detail are RETAINED after `product` goes
 * null, and this component never returns null itself. That is what makes the
 * close animation possible at all: Radix only plays a [data-state=closed]
 * animation if the Sheet is still mounted to reach that state, and it only
 * looks right if there is still content inside the panel on the way out.
 */
function ProductDetailDrawer({
  product,
  accessToken,
  onClose,
  onEdit,
  onPackagings,
}: {
  product: Product | null;
  accessToken?: string;
  onClose: () => void;
  onEdit: (product: Product) => void;
  onPackagings: (product: Product) => void;
}) {
  /** Last product opened. Outlives `product` so the panel has something to show while sliding out. */
  const [shown, setShown] = useState<Product | null>(null);
  const [full, setFull] = useState<Product | null>(null);
  const [packagingsByVariant, setPackagingsByVariant] = useState<Record<string, VariantUnit[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Deliberately does nothing on close: clearing state here would blank the
    // panel out mid-slide instead of letting it leave with its content.
    if (!product || !accessToken) return;

    let cancelled = false;
    setShown(product);
    setFull(null);
    setPackagingsByVariant({});
    setError(null);
    setLoading(true);

    api
      .get<Product>(`/products/${product.id}`, { accessToken })
      .then(async (detail) => {
        if (cancelled) return;
        setFull(detail);
        const entries = await Promise.all(
          (detail.variants ?? []).map(async (v) => {
            try {
              const rows = await api.get<VariantUnit[]>(`/products/variants/${v.id}/units`, { accessToken });
              return [v.id, rows ?? []] as const;
            } catch {
              return [v.id, []] as const; // Non-critical — the drawer still shows everything else.
            }
          }),
        );
        if (!cancelled) setPackagingsByVariant(Object.fromEntries(entries));
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || "Failed to load product detail.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [product, accessToken]);

  const categoryLabel = shown?.categoryName || shown?.category?.name || null;
  const brandLabel = shown?.brandName || null;
  const unitAbbr = shown?.unitAbbr || shown?.unit?.name || "";
  const isActive = full?.isActive ?? shown?.isActive ?? false;
  const primaryImage = full?.images?.find((i) => i.isPrimary) ?? full?.images?.[0] ?? null;
  const variants = full?.variants ?? [];

  const money = (value?: string | null) => (value ? `AED ${parseFloat(value).toFixed(2)}` : "—");

  return (
    <Sheet open={product !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        <SheetHeader>
          <div className="flex items-start gap-3">
            {primaryImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={primaryImage.url}
                alt={primaryImage.altText ?? shown?.name ?? ""}
                className="h-11 w-11 shrink-0 rounded-xl border border-border object-cover"
              />
            ) : (
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-blue-500 to-indigo-600 text-white">
                <Package className="h-5 w-5" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate leading-snug">{shown?.name ?? ""}</SheetTitle>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="truncate font-mono text-[11px] text-muted-foreground">{shown?.sku}</span>
                <Badge variant={isActive ? "success" : "secondary"} className="shrink-0 text-[9px]">
                  {isActive ? "Active" : "Inactive"}
                </Badge>
                {brandLabel && (
                  <Badge variant="outline" className="shrink-0 text-[9px]">{brandLabel}</Badge>
                )}
              </div>
            </div>
          </div>
        </SheetHeader>

        <SheetBody>
          {error ? (
            <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          ) : loading || !full ? (
            // Skeleton rather than a spinner: the shape of what's coming
            // reads as "nearly there" instead of "nothing here yet".
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2.5">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-16 animate-pulse rounded-xl bg-muted/60" />
                ))}
              </div>
              <div className="h-3 w-1/3 animate-pulse rounded bg-muted/60" />
              <div className="h-24 animate-pulse rounded-xl bg-muted/60" />
              <div className="h-24 animate-pulse rounded-xl bg-muted/60" />
            </div>
          ) : (
            <div className="space-y-6">
              <Reveal index={0}>
                <div className="grid grid-cols-2 gap-2.5">
                  <StatTile label="Category" value={categoryLabel || "—"} />
                  <StatTile label="Brand" value={brandLabel || "—"} />
                  <StatTile label="Unit of Measure" value={unitAbbr || "—"} />
                  <StatTile label="Tax Rate" value={full.taxRate != null ? `${full.taxRate}%` : "—"} mono />
                </div>
              </Reveal>

              {full.description && (
                <Reveal index={1}>
                  <section>
                    <SectionLabel icon={FileUp}>Description</SectionLabel>
                    <p className="rounded-xl bg-muted/40 p-3.5 text-xs leading-relaxed text-foreground">
                      {full.description}
                    </p>
                  </section>
                </Reveal>
              )}

              {full.images && full.images.length > 0 && (
                <Reveal index={2}>
                  <section>
                    <SectionLabel icon={ImageIcon}>Photos ({full.images.length})</SectionLabel>
                    <div className="flex flex-wrap gap-2">
                      {full.images.map((img) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={img.id}
                          src={img.url}
                          alt={img.altText ?? shown?.name ?? ""}
                          title={img.isPrimary ? "Primary photo" : undefined}
                          className={cn(
                            "h-18 w-18 rounded-xl border object-cover transition-transform hover:scale-105",
                            img.isPrimary ? "border-primary ring-2 ring-primary/30" : "border-border",
                          )}
                        />
                      ))}
                    </div>
                  </section>
                </Reveal>
              )}

              <Reveal index={3}>
                <section>
                  <SectionLabel icon={Layers}>Variants ({variants.length})</SectionLabel>

                  {variants.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                      No variants on this product.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {variants.map((v) => {
                        const packagings = packagingsByVariant[v.id] ?? [];
                        return (
                          <div
                            key={v.id}
                            className="overflow-hidden rounded-xl border border-border transition-colors hover:border-primary/40"
                          >
                            <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3.5 py-2.5">
                              <div className="min-w-0">
                                <p className="truncate text-xs font-bold text-foreground">{v.variantName}</p>
                                <p className="truncate font-mono text-[10px] text-muted-foreground">
                                  {v.sku}
                                  {v.barcode ? ` · ${v.barcode}` : ""}
                                </p>
                              </div>
                              <Badge variant={v.isActive ? "success" : "secondary"} className="shrink-0 text-[9px]">
                                {v.isActive ? "Active" : "Inactive"}
                              </Badge>
                            </div>

                            <div className="grid grid-cols-3 divide-x divide-border">
                              <VariantStat label="Stock" value={`${v.stock ?? "—"} ${unitAbbr}`.trim()} />
                              <VariantStat label="Selling" value={money(v.sellingPrice)} />
                              <VariantStat
                                label="Cost"
                                value={v.purchasePrice === undefined ? "Hidden" : money(v.purchasePrice)}
                                muted={v.purchasePrice === undefined}
                              />
                            </div>

                            {packagings.length > 0 && (
                              <div className="border-t border-border px-3.5 py-2.5">
                                <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                                  Packagings
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  {packagings.map((p) => (
                                    <span
                                      key={p.id}
                                      className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/50 px-2 py-1 text-[10px]"
                                    >
                                      <Boxes className="h-3 w-3 text-muted-foreground" />
                                      <span className="font-semibold text-foreground">{p.unitName}</span>
                                      <span className="font-mono text-muted-foreground">
                                        = {p.conversionFactor} {unitAbbr}
                                      </span>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </Reveal>
            </div>
          )}
        </SheetBody>

        {full && (
          <SheetFooter>
            <Button variant="outline" onClick={() => onPackagings(full)}>
              <Boxes className="h-3.5 w-3.5" />
              Packagings
            </Button>
            <Button onClick={() => onEdit(full)}>
              <Pencil className="h-3.5 w-3.5" />
              Edit Details
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Small labelled tile used for the product's top-level attributes. */
function StatTile({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl bg-muted/40 p-3">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mt-1 truncate text-xs font-semibold text-foreground", mono && "font-mono")} title={value}>
        {value}
      </p>
    </div>
  );
}

/** One cell of a variant card's stock/price row. */
function VariantStat({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="px-3 py-2.5">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 truncate font-mono text-[11px] font-semibold",
          muted ? "text-muted-foreground italic" : "text-foreground",
        )}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

/** Section heading with a leading icon, consistent across the drawer. */
function SectionLabel({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
      {children}
    </p>
  );
}

// ── Packagings ───────────────────────────────────────────────────────────────

/**
 * Define how a variant is sold in bulk — 1 carton = 20 pieces — without SQL.
 *
 * Fetches the product's real variants fresh on open rather than trusting
 * whatever the list row carries, since the list response never eagerly
 * includes the full variant array. Packagings are pure configuration, not a
 * document: a sale snapshots its own conversion factor at the moment it
 * happens, so editing or removing one here never rewrites a past invoice —
 * which is also why removing one is a real delete, not a deactivation.
 */
function PackagingsDialog({
  product,
  units,
  accessToken,
  onClose,
  onUnitCreated,
}: {
  product: Product | null;
  units: Unit[];
  accessToken?: string;
  onClose: () => void;
  onUnitCreated: (unit: Unit) => void;
}) {
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [variantId, setVariantId] = useState("");
  const [packagings, setPackagings] = useState<VariantUnit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newUnitId, setNewUnitId] = useState("");
  const [newFactor, setNewFactor] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [adding, setAdding] = useState(false);

  const fetchPackagings = useCallback(
    async (forVariantId: string) => {
      if (!forVariantId) return;
      setLoading(true);
      setError(null);
      try {
        const rows = await api.get<VariantUnit[]>(
          `/products/variants/${forVariantId}/units`,
          { accessToken },
        );
        setPackagings(rows ?? []);
      } catch (err: any) {
        setError(err?.message || "Failed to load packagings.");
      } finally {
        setLoading(false);
      }
    },
    [accessToken],
  );

  useEffect(() => {
    if (!product || !accessToken) return;
    setError(null);
    setNewUnitId("");
    setNewFactor("");
    setNewPrice("");

    api
      .get<Product>(`/products/${product.id}`, { accessToken })
      .then((full) => {
        const vs = full.variants ?? [];
        setVariants(vs);
        const first = vs[0]?.id ?? "";
        setVariantId(first);
        if (first) void fetchPackagings(first);
      })
      .catch((err: any) => setError(err?.message || "Failed to load the product's variants."));
    // Re-runs only when a different product is opened — switching the variant
    // dropdown re-fetches packagings on its own, below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, accessToken]);

  async function addPackaging(e: React.FormEvent) {
    e.preventDefault();
    if (!newUnitId || !newFactor) {
      setError("Choose a unit and a conversion factor.");
      return;
    }
    setAdding(true);
    setError(null);
    try {
      await api.post(
        `/products/variants/${variantId}/units`,
        {
          unitId: newUnitId,
          conversionFactor: parseFloat(newFactor),
          ...(newPrice ? { priceOverride: parseFloat(newPrice) } : {}),
        },
        { accessToken },
      );
      setNewUnitId("");
      setNewFactor("");
      setNewPrice("");
      await fetchPackagings(variantId);
    } catch (err: any) {
      setError(err?.message || "Failed to add the packaging.");
    } finally {
      setAdding(false);
    }
  }

  /**
   * Sellable and purchasable are independent: a supplier's outer carton is
   * bought and never sold, a loose piece sold and never bought.
   */
  async function toggleFlag(row: VariantUnit, flag: "isSellable" | "isPurchasable") {
    setError(null);
    try {
      await api.patch(
        `/products/variant-units/${row.id}`,
        { [flag]: !row[flag] },
        { accessToken },
      );
      await fetchPackagings(variantId);
    } catch (err: any) {
      setError(err?.message || "Failed to update the packaging.");
    }
  }

  async function removePackaging(row: VariantUnit) {
    setError(null);
    try {
      await api.delete(`/products/variant-units/${row.id}`, { accessToken });
      await fetchPackagings(variantId);
    } catch (err: any) {
      setError(err?.message || "Failed to remove the packaging.");
    }
  }

  const availableUnits = units.filter((u) => !packagings.some((p) => p.unitId === u.id));

  return (
    <Dialog open={product !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-amber-500 to-orange-600 text-white">
              <Boxes className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle>Packagings — {product?.name}</DialogTitle>
              <DialogDescription>
                Sell the same variant by the piece, the box, or the carton.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" /><span>{error}</span>
          </div>
        )}

        {variants.length > 1 && (
          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">Variant</label>
            <Select
              value={variantId}
              onValueChange={(val) => {
                setVariantId(val);
                void fetchPackagings(val);
              }}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="— Select Variant —" />
              </SelectTrigger>
              <SelectContent>
                {variants.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.variantName} ({v.sku})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="rounded-xl border border-border">
            {packagings.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                Only the base unit is sold. Add a packaging below.
              </p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Unit</th>
                    <th className="px-3 py-2 text-right font-medium">= base units</th>
                    <th className="px-3 py-2 text-right font-medium">Price</th>
                    <th className="px-3 py-2 text-center font-medium">Sell</th>
                    <th className="px-3 py-2 text-center font-medium">Buy</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {packagings.map((row) => (
                    <tr key={row.id}>
                      <td className="px-3 py-2 font-medium">{row.unitName}</td>
                      <td className="px-3 py-2 text-right font-mono">{row.conversionFactor}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {row.priceOverride ?? "computed"}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => void toggleFlag(row, "isSellable")}
                          aria-label={`Toggle whether ${row.unitName} can be sold`}
                          className="cursor-pointer"
                        >
                          <Badge variant={row.isSellable ? "success" : "secondary"}>
                            {row.isSellable ? "Yes" : "No"}
                          </Badge>
                        </button>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => void toggleFlag(row, "isPurchasable")}
                          aria-label={`Toggle whether ${row.unitName} can be bought`}
                          className="cursor-pointer"
                        >
                          <Badge variant={row.isPurchasable ? "success" : "secondary"}>
                            {row.isPurchasable ? "Yes" : "No"}
                          </Badge>
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => void removePackaging(row)}
                          aria-label={`Remove ${row.unitName} packaging`}
                          className="cursor-pointer text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {availableUnits.length > 0 && (
          <form onSubmit={addPackaging} className="rounded-xl border border-border p-4 space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Add a packaging
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="block text-xs font-medium text-foreground">Unit *</label>
                  <NewUnitDialog
                    accessToken={accessToken}
                    onCreated={(u) => { onUnitCreated(u); setNewUnitId(u.id); }}
                  />
                </div>
                <Select value={newUnitId} onValueChange={setNewUnitId}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="— Select Unit —" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableUnits.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">
                  = base units *
                </label>
                <Input
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  value={newFactor}
                  onChange={(e) => setNewFactor(e.target.value)}
                  placeholder="e.g. 20"
                  className="font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">
                  Flat price (optional)
                </label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  placeholder="base x factor"
                  className="font-mono"
                />
              </div>
            </div>
            <Button type="submit" size="sm" disabled={adding}>
              <Plus className="h-3.5 w-3.5" />
              {adding ? "Adding…" : "Add packaging"}
            </Button>
          </form>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
