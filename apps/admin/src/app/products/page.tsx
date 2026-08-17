"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Package, Search, Plus, RefreshCw, X, AlertCircle, CheckCircle2 } from "lucide-react";
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

// ── Types ──────────────────────────────────────────────────────────────────

interface ProductVariant {
  id: string;
  sku: string;
  barcode: string | null;
  variantName: string;
  isActive: boolean;
  prices?: { sellingPrice: string; wholesalePrice?: string }[];
}

interface Product {
  id: string;
  name: string;
  sku: string;
  isActive: boolean;
  categoryId?: string;
  categoryName?: string;
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

interface Category {
  id: string;
  name: string;
  children?: Category[];
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

// ── Component ────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const { tokens } = useAuth();

  // List state
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const LIMIT = 50;

  // Lookups
  const [units, setUnits] = useState<Unit[]>([]);
  const [categories, setCategories] = useState<{ id: string; label: string }[]>([]);

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
      setProducts(list);
      setTotal(totalCount);
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
    ]).then(([unitsRes, catsRes, branchesRes]) => {
      if (unitsRes.status === "fulfilled") setUnits(unitsRes.value ?? []);
      if (catsRes.status === "fulfilled") setCategories(flattenCategories(catsRes.value ?? []));
      if (branchesRes.status === "fulfilled") {
        const bs = branchesRes.value?.items ?? [];
        setBranches(bs);
        if (bs.length > 0 && bs[0]) setFBranchId(bs[0].id);
      }
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
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={fetchProducts} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
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
                    <tr key={product.id} className="hover:bg-secondary/30 transition-colors">
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {total > LIMIT && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <span className="text-xs text-muted-foreground">
              Showing {((page - 1) * LIMIT) + 1}–{Math.min(page * LIMIT, total)} of {total}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page * LIMIT >= total} onClick={() => setPage(p => p + 1)}>
                Next
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
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
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
                  <label className="block text-xs font-medium text-foreground mb-1.5">Unit of Measure *</label>
                  <select
                    required
                    value={fUnitId}
                    onChange={e => setFUnitId(e.target.value)}
                    className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">— Select unit —</option>
                    {units.map(u => (
                      <option key={u.id} value={u.id}>{u.name}{u.abbreviation ? ` (${u.abbreviation})` : ""}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Category</label>
                  <select
                    value={fCategoryId}
                    onChange={e => setFCategoryId(e.target.value)}
                    className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">— No category —</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
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
                  <select
                    value={fBranchId}
                    onChange={e => setFBranchId(e.target.value)}
                    className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">— Select branch —</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
                    ))}
                  </select>
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
    </div>
  );
}
