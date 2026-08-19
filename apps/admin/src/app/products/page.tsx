"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Package, Search, Plus, RefreshCw, X, AlertCircle, CheckCircle2, Boxes, Trash2 } from "lucide-react";
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
  isSellable: boolean;
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

  // Packagings dialog
  const [packagingProduct, setPackagingProduct] = useState<Product | null>(null);

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
                  <th className="px-4 py-3.5 text-center font-medium">Packagings</th>
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
                      <td className="px-4 py-3.5 text-center">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPackagingProduct(product)}
                        >
                          <Boxes className="h-3.5 w-3.5" />
                          Manage
                        </Button>
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

      <PackagingsDialog
        product={packagingProduct}
        units={units}
        accessToken={tokens?.accessToken}
        onClose={() => setPackagingProduct(null)}
      />
    </div>
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
}: {
  product: Product | null;
  units: Unit[];
  accessToken?: string;
  onClose: () => void;
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

  async function toggleSellable(row: VariantUnit) {
    setError(null);
    try {
      await api.patch(
        `/products/variant-units/${row.id}`,
        { isSellable: !row.isSellable },
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
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 text-white">
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
            <select
              value={variantId}
              onChange={(e) => {
                setVariantId(e.target.value);
                void fetchPackagings(e.target.value);
              }}
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.variantName} ({v.sku})
                </option>
              ))}
            </select>
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
                    <th className="px-3 py-2 text-center font-medium">Sellable</th>
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
                          onClick={() => void toggleSellable(row)}
                          className="cursor-pointer"
                        >
                          <Badge variant={row.isSellable ? "success" : "secondary"}>
                            {row.isSellable ? "Yes" : "No"}
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
                <label className="block text-xs font-medium text-foreground mb-1.5">Unit *</label>
                <select
                  value={newUnitId}
                  onChange={(e) => setNewUnitId(e.target.value)}
                  className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">— Select —</option>
                  {availableUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
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
