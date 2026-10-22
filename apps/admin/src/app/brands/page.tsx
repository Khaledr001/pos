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
  SortableTh, Table, TableBody, TableContainer, TableEmpty, TableHead, Th,
} from "@/components/ui/data-table";
import { MobileEmpty, MobileList, MobileRow, MobileSort, listCard } from "@/components/ui/mobile-list";
import type { SortOrder } from "@/lib/use-list-query";
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
  const [nameOrder, setNameOrder] = useState<SortOrder>("asc");
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

  const sortedBrands = [...brands].sort((a, b) =>
    nameOrder === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Brands</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Manufacturer and brand names products can be tagged with.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
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

      <MobileSort
        options={[{ column: "name", label: "Name" }]}
        sortBy="name"
        sortOrder={nameOrder}
        onChange={(_, order) => setNameOrder(order)}
      />

      <MobileList
        loading={loading && brands.length === 0}
        empty={
          <MobileEmpty
            icon={Tag}
            title="No brands yet"
            action={
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5" /> Add Brand
              </Button>
            }
          />
        }
      >
        {sortedBrands.map((brand) => (
          <MobileRow
            key={brand.id}
            title={brand.name}
            subtitle={brand.slug}
            badge={
              <Badge variant={brand.isActive ? "success" : "secondary"}>
                {brand.isActive ? "Active" : "Inactive"}
              </Badge>
            }
            fields={[
              { label: "Slug", value: <span className="font-mono">{brand.slug}</span> },
              ...(brand.logoUrl
                ? [{
                    label: "Logo",
                    // eslint-disable-next-line @next/next/no-img-element
                    value: <img src={brand.logoUrl} alt="" className="ml-auto h-6 w-6 rounded object-contain" />,
                  }]
                : []),
            ]}
            actions={
              <>
                <Button variant="outline" size="sm" onClick={() => openEdit(brand)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                <Button variant="outline" size="sm" className="text-destructive" onClick={() => void handleDelete(brand)}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </>
            }
          />
        ))}
      </MobileList>

      <Card className={listCard}>
        <TableContainer className="hidden md:block">
          <Table>
            <TableHead>
              <tr>
                <SortableTh column="name" sortBy="name" sortOrder={nameOrder} onSort={() => setNameOrder((o) => (o === "asc" ? "desc" : "asc"))}>Name</SortableTh>
                <Th>Slug</Th>
                <Th align="center">Status</Th>
                <Th align="right">Actions</Th>
              </tr>
            </TableHead>
            <TableBody
              columns={4}
              loading={loading && brands.length === 0}
              empty={
                <TableEmpty
                  columns={4}
                  icon={Tag}
                  title="No brands yet"
                  action={
                    <Button size="sm" onClick={openCreate}>
                      <Plus className="h-3.5 w-3.5" /> Add Brand
                    </Button>
                  }
                />
              }
            >
              {sortedBrands.map((brand) => (
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
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Dialog open={isOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-amber-500 to-orange-600 text-white">
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
