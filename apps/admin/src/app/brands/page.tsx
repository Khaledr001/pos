"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Tag, Plus, RefreshCw, X, AlertCircle, CheckCircle2, Pencil, Trash2 } from "lucide-react";
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

interface Brand {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  isActive: boolean;
}

export default function BrandsPage() {
  const { tokens } = useAuth();

  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const [editing, setEditing] = useState<Brand | null>(null);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [fName, setFName] = useState("");
  const [fLogoUrl, setFLogoUrl] = useState("");
  const [fIsActive, setFIsActive] = useState(true);

  const fetchBrands = useCallback(async () => {
    setLoading(true);
    setActionError(null);
    try {
      const rows = await api.get<Brand[]>("/brands", {
        accessToken: tokens?.accessToken,
        query: { includeInactive: "true" },
      });
      setBrands(rows ?? []);
    } catch (err: any) {
      setActionError(err?.message || "Failed to load brands.");
    } finally {
      setLoading(false);
    }
  }, [tokens]);

  useEffect(() => {
    fetchBrands();
  }, [fetchBrands]);

  function openCreate() {
    setEditing(null);
    setCreating(true);
    setFName("");
    setFLogoUrl("");
    setFIsActive(true);
    setActionError(null);
  }

  function openEdit(brand: Brand) {
    setCreating(false);
    setEditing(brand);
    setFName(brand.name);
    setFLogoUrl(brand.logoUrl ?? "");
    setFIsActive(brand.isActive);
    setActionError(null);
  }

  function closeDialog() {
    setCreating(false);
    setEditing(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setActionError(null);

    const body = {
      name: fName,
      logoUrl: fLogoUrl || undefined,
      ...(editing ? { isActive: fIsActive } : {}),
    };

    try {
      if (editing) {
        await api.patch(`/brands/${editing.id}`, body, { accessToken: tokens?.accessToken });
        setActionSuccess(`"${fName}" updated.`);
      } else {
        await api.post("/brands", body, { accessToken: tokens?.accessToken });
        setActionSuccess(`"${fName}" created.`);
      }
      closeDialog();
      await fetchBrands();
    } catch (err: any) {
      setActionError(err?.message || "Failed to save the brand.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(brand: Brand) {
    if (!window.confirm(`Delete "${brand.name}"? This cannot be undone.`)) return;
    setActionError(null);
    try {
      await api.delete(`/brands/${brand.id}`, { accessToken: tokens?.accessToken });
      setActionSuccess(`"${brand.name}" deleted.`);
      await fetchBrands();
    } catch (err: any) {
      setActionError(err?.message || "Failed to delete the brand.");
    }
  }

  const isOpen = creating || editing !== null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Brands</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Manufacturer and brand names products can be tagged with.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={fetchBrands} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Add Brand
          </Button>
        </div>
      </div>

      {actionSuccess && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400">
          <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /><span>{actionSuccess}</span></div>
          <button onClick={() => setActionSuccess(null)} className="cursor-pointer"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {actionError && !isOpen && (
        <div className="flex items-center justify-between rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <div className="flex items-center gap-2"><AlertCircle className="h-4 w-4" /><span>{actionError}</span></div>
          <button onClick={() => setActionError(null)} className="cursor-pointer"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            <div className="h-6 w-6 mx-auto mb-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Loading brands...
          </div>
        ) : brands.length === 0 ? (
          <div className="py-16 text-center">
            <Tag className="mx-auto h-12 w-12 text-muted-foreground/30" />
            <h3 className="mt-4 text-sm font-semibold text-foreground">No brands yet</h3>
            <Button size="sm" onClick={openCreate} className="mt-4">
              <Plus className="h-3.5 w-3.5" /> Add Brand
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3.5 font-medium">Name</th>
                  <th className="px-4 py-3.5 font-medium">Slug</th>
                  <th className="px-4 py-3.5 text-center font-medium">Status</th>
                  <th className="px-4 py-3.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {brands.map((brand) => (
                  <tr key={brand.id} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3.5 font-medium text-foreground">
                      <div className="flex items-center gap-2">
                        {brand.logoUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={brand.logoUrl} alt="" className="h-5 w-5 rounded object-contain" />
                        )}
                        {brand.name}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-muted-foreground">{brand.slug}</td>
                    <td className="px-4 py-3.5 text-center">
                      <Badge variant={brand.isActive ? "success" : "secondary"}>
                        {brand.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(brand)}
                          aria-label={`Edit ${brand.name}`}
                          className="cursor-pointer text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(brand)}
                          aria-label={`Delete ${brand.name}`}
                          className="cursor-pointer text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog open={isOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 text-white">
                <Tag className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle>{editing ? `Edit ${editing.name}` : "Add Brand"}</DialogTitle>
                <DialogDescription>
                  {editing ? "Renaming keeps every product tagged with it." : "Creates a new brand products can be tagged with."}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {actionError && (
            <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" /><span>{actionError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Name *</label>
              <Input required value={fName} onChange={(e) => setFName(e.target.value)} placeholder="e.g. Ducab" />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Logo URL</label>
              <Input
                type="url"
                value={fLogoUrl}
                onChange={(e) => setFLogoUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
            {editing && (
              <label className="flex items-center gap-2 text-xs font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={fIsActive}
                  onChange={(e) => setFIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                Active
              </label>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving..." : editing ? "Save Changes" : "Create Brand"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
