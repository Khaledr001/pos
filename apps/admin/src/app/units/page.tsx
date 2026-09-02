"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Ruler, Plus, RefreshCw, X, AlertCircle, CheckCircle2, Pencil, Trash2 } from "lucide-react";
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

interface Unit {
  id: string;
  name: string;
  abbreviation: string;
  allowsFractions: boolean;
}

export default function UnitsPage() {
  const { tokens } = useAuth();

  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const [editing, setEditing] = useState<Unit | null>(null);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [fName, setFName] = useState("");
  const [fAbbreviation, setFAbbreviation] = useState("");
  const [fAllowsFractions, setFAllowsFractions] = useState(false);

  const fetchUnits = useCallback(async () => {
    setLoading(true);
    setActionError(null);
    try {
      const rows = await api.get<Unit[]>("/units", { accessToken: tokens?.accessToken });
      setUnits(rows ?? []);
    } catch (err: any) {
      setActionError(err?.message || "Failed to load units.");
    } finally {
      setLoading(false);
    }
  }, [tokens]);

  useEffect(() => {
    fetchUnits();
  }, [fetchUnits]);

  function openCreate() {
    setEditing(null);
    setCreating(true);
    setFName("");
    setFAbbreviation("");
    setFAllowsFractions(false);
    setActionError(null);
  }

  function openEdit(unit: Unit) {
    setCreating(false);
    setEditing(unit);
    setFName(unit.name);
    setFAbbreviation(unit.abbreviation);
    setFAllowsFractions(unit.allowsFractions);
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

    try {
      if (editing) {
        // `allowsFractions` can't change once set — see LookupsService.updateUnit.
        await api.patch(
          `/units/${editing.id}`,
          { name: fName, abbreviation: fAbbreviation },
          { accessToken: tokens?.accessToken },
        );
        setActionSuccess(`"${fName}" updated.`);
      } else {
        await api.post(
          "/units",
          { name: fName, abbreviation: fAbbreviation, allowsFractions: fAllowsFractions },
          { accessToken: tokens?.accessToken },
        );
        setActionSuccess(`"${fName}" created.`);
      }
      closeDialog();
      await fetchUnits();
    } catch (err: any) {
      setActionError(err?.message || "Failed to save the unit.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(unit: Unit) {
    if (!window.confirm(`Delete "${unit.name}"? This cannot be undone.`)) return;
    setActionError(null);
    try {
      await api.delete(`/units/${unit.id}`, { accessToken: tokens?.accessToken });
      setActionSuccess(`"${unit.name}" deleted.`);
      await fetchUnits();
    } catch (err: any) {
      setActionError(err?.message || "Failed to delete the unit.");
    }
  }

  const isOpen = creating || editing !== null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Units of Measure</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Base units products are stocked in — Piece, Box, Roll, Kilogram. Sell a product
            by a different packaging (a box of 20, a 100m roll) from the Packagings dialog
            on the Products page.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Button variant="outline" size="sm" onClick={fetchUnits} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Add Unit
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
            Loading units...
          </div>
        ) : units.length === 0 ? (
          <div className="py-16 text-center">
            <Ruler className="mx-auto h-12 w-12 text-muted-foreground/30" />
            <h3 className="mt-4 text-sm font-semibold text-foreground">No units yet</h3>
            <Button size="sm" onClick={openCreate} className="mt-4">
              <Plus className="h-3.5 w-3.5" /> Add Unit
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3.5 font-medium">Name</th>
                  <th className="px-4 py-3.5 font-medium">Abbreviation</th>
                  <th className="px-4 py-3.5 text-center font-medium">Fractional Qty</th>
                  <th className="px-4 py-3.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {units.map((unit) => (
                  <tr key={unit.id} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3.5 font-medium text-foreground">{unit.name}</td>
                    <td className="px-4 py-3.5 font-mono text-muted-foreground uppercase">{unit.abbreviation}</td>
                    <td className="px-4 py-3.5 text-center">
                      <Badge variant={unit.allowsFractions ? "success" : "secondary"}>
                        {unit.allowsFractions ? "Yes" : "Whole only"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(unit)}
                          aria-label={`Edit ${unit.name}`}
                          className="cursor-pointer text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(unit)}
                          aria-label={`Delete ${unit.name}`}
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
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-cyan-500 to-blue-600 text-white">
                <Ruler className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle>{editing ? `Edit ${editing.name}` : "Add Unit"}</DialogTitle>
                <DialogDescription>
                  {editing
                    ? "Renaming keeps every product measured in it."
                    : "e.g. Piece, Box, Roll, Kilogram — the base unit a product's stock is held in."}
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
              <Input required maxLength={50} value={fName} onChange={(e) => setFName(e.target.value)} placeholder="e.g. Roll" />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Abbreviation *</label>
              <Input
                required
                maxLength={10}
                value={fAbbreviation}
                onChange={(e) => setFAbbreviation(e.target.value)}
                placeholder="e.g. roll"
                className="font-mono"
              />
            </div>
            <div>
              <label className={cn("flex items-center gap-2 text-xs font-medium", editing ? "text-muted-foreground" : "text-foreground")}>
                <input
                  type="checkbox"
                  checked={fAllowsFractions}
                  disabled={!!editing}
                  onChange={(e) => setFAllowsFractions(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                Allows fractional quantities (e.g. 5.5 metres)
              </label>
              {editing && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Fixed at creation — changing it could invalidate existing stock balances.
                </p>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving..." : editing ? "Save Changes" : "Create Unit"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
