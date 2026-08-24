"use client";

import React, { useCallback, useEffect, useState } from "react";
import { FolderTree, Plus, RefreshCw, X, AlertCircle, CheckCircle2, Pencil, Trash2 } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Category {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  skuPrefix: string | null;
  depth: number;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
  children?: Category[];
}

/** Depth-first, so the tree's own order (sortOrder within each parent) is preserved. */
function flatten(cats: Category[]): Category[] {
  const result: Category[] = [];
  for (const c of cats) {
    result.push(c);
    if (c.children?.length) result.push(...flatten(c.children));
  }
  return result;
}

export default function CategoriesPage() {
  const { tokens } = useAuth();

  const [tree, setTree] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const [editing, setEditing] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [fName, setFName] = useState("");
  const [fParentId, setFParentId] = useState("");
  const [fSkuPrefix, setFSkuPrefix] = useState("");
  const [fSortOrder, setFSortOrder] = useState("0");
  const [fIsActive, setFIsActive] = useState(true);

  const fetchTree = useCallback(async () => {
    setLoading(true);
    setActionError(null);
    try {
      const rows = await api.get<Category[]>("/categories", {
        accessToken: tokens?.accessToken,
        query: { includeInactive: "true" },
      });
      setTree(rows ?? []);
    } catch (err: any) {
      setActionError(err?.message || "Failed to load categories.");
    } finally {
      setLoading(false);
    }
  }, [tokens]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  const flat = flatten(tree);

  function openCreate() {
    setEditing(null);
    setCreating(true);
    setFName("");
    setFParentId("");
    setFSkuPrefix("");
    setFSortOrder("0");
    setFIsActive(true);
    setActionError(null);
  }

  function openEdit(cat: Category) {
    setCreating(false);
    setEditing(cat);
    setFName(cat.name);
    setFParentId(cat.parentId ?? "");
    setFSkuPrefix(cat.skuPrefix ?? "");
    setFSortOrder(String(cat.sortOrder));
    setFIsActive(cat.isActive);
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
      parentId: fParentId || null,
      skuPrefix: fSkuPrefix || undefined,
      sortOrder: fSortOrder ? Number(fSortOrder) : undefined,
      ...(editing ? { isActive: fIsActive } : {}),
    };

    try {
      if (editing) {
        await api.patch(`/categories/${editing.id}`, body, { accessToken: tokens?.accessToken });
        setActionSuccess(`"${fName}" updated.`);
      } else {
        await api.post("/categories", body, { accessToken: tokens?.accessToken });
        setActionSuccess(`"${fName}" created.`);
      }
      closeDialog();
      await fetchTree();
    } catch (err: any) {
      setActionError(err?.message || "Failed to save the category.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(cat: Category) {
    if (!window.confirm(`Delete "${cat.name}"? This cannot be undone.`)) return;
    setActionError(null);
    try {
      await api.delete(`/categories/${cat.id}`, { accessToken: tokens?.accessToken });
      setActionSuccess(`"${cat.name}" deleted.`);
      await fetchTree();
    } catch (err: any) {
      setActionError(err?.message || "Failed to delete the category.");
    }
  }

  const isOpen = creating || editing !== null;
  // A category cannot become its own ancestor — offer every OTHER category as a parent.
  const parentOptions = flat.filter((c) => c.id !== editing?.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Categories</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            The tree products are organised under — up to 5 levels deep.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Button variant="outline" size="sm" onClick={fetchTree} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Add Category
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
            Loading categories...
          </div>
        ) : flat.length === 0 ? (
          <div className="py-16 text-center">
            <FolderTree className="mx-auto h-12 w-12 text-muted-foreground/30" />
            <h3 className="mt-4 text-sm font-semibold text-foreground">No categories yet</h3>
            <Button size="sm" onClick={openCreate} className="mt-4">
              <Plus className="h-3.5 w-3.5" /> Add Category
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3.5 font-medium">Name</th>
                  <th className="px-4 py-3.5 font-medium">SKU Prefix</th>
                  <th className="px-4 py-3.5 text-center font-medium">Products</th>
                  <th className="px-4 py-3.5 text-center font-medium">Status</th>
                  <th className="px-4 py-3.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {flat.map((cat) => (
                  <tr key={cat.id} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3.5 font-medium text-foreground">
                      <span style={{ paddingLeft: `${cat.depth * 1.25}rem` }}>
                        {cat.depth > 0 && <span className="text-muted-foreground mr-1.5">└</span>}
                        {cat.name}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-muted-foreground">{cat.skuPrefix || "—"}</td>
                    <td className="px-4 py-3.5 text-center">
                      <Badge variant="outline" className="text-[10px]">{cat.productCount}</Badge>
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <Badge variant={cat.isActive ? "success" : "secondary"}>
                        {cat.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(cat)}
                          aria-label={`Edit ${cat.name}`}
                          className="cursor-pointer text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(cat)}
                          aria-label={`Delete ${cat.name}`}
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
                <FolderTree className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle>{editing ? `Edit ${editing.name}` : "Add Category"}</DialogTitle>
                <DialogDescription>
                  {editing ? "Renaming or moving it carries the whole subtree." : "Creates a new category, optionally under a parent."}
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
              <Input required value={fName} onChange={(e) => setFName(e.target.value)} placeholder="e.g. Plumbing" />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Parent Category</label>
              <Select value={fParentId || "root"} onValueChange={(val) => setFParentId(val === "root" ? "" : val)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="— Top Level Category —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="root">— Top Level Category —</SelectItem>
                  {parentOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {"— ".repeat(c.depth)}{c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">SKU Prefix</label>
                <Input
                  value={fSkuPrefix}
                  onChange={(e) => setFSkuPrefix(e.target.value)}
                  placeholder="e.g. PLB"
                  className="font-mono uppercase"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Sort Order</label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={fSortOrder}
                  onChange={(e) => setFSortOrder(e.target.value)}
                  className="font-mono"
                />
              </div>
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
                {submitting ? "Saving..." : editing ? "Save Changes" : "Create Category"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
