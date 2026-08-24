"use client";

import React, { useEffect, useState, useCallback } from "react";
import { ShieldCheck, Plus, RefreshCw, X, AlertCircle, CheckCircle2, Trash2, Lock } from "lucide-react";
import { PERMISSIONS, SUPERUSER_PERMISSION, type PermissionGrant } from "@devsfleet/shared-types";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface Role {
  id: string;
  name: string;
  description: string | null;
  permissions: PermissionGrant[];
  isSystem: boolean;
}

/** "product:read" -> group "product". Purely a display grouping, not a permission model. */
function groupPermissions(): Record<string, PermissionGrant[]> {
  const groups: Record<string, PermissionGrant[]> = {};
  for (const p of PERMISSIONS) {
    const [resource] = p.split(":");
    (groups[resource!] ??= []).push(p);
  }
  return groups;
}
const PERMISSION_GROUPS = groupPermissions();

export default function RolesPage() {
  const { tokens } = useAuth();

  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const [editing, setEditing] = useState<Role | null>(null);
  const [creating, setCreating] = useState(false);

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    setActionError(null);
    try {
      const rows = await api.get<Role[]>("/roles", { accessToken: tokens?.accessToken });
      setRoles(rows ?? []);
    } catch (err: any) {
      setActionError(err?.message || "Failed to load roles from the API.");
    } finally {
      setLoading(false);
    }
  }, [tokens]);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  const removeRole = async (role: Role) => {
    if (!confirm(`Delete the role "${role.name}"? This cannot be undone.`)) return;
    setActionError(null);
    try {
      await api.delete(`/roles/${role.id}`, { accessToken: tokens?.accessToken });
      setActionSuccess(`Role "${role.name}" deleted.`);
      fetchRoles();
    } catch (err: any) {
      setActionError(err?.message || "Failed to delete the role.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Roles & Permissions</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            What each role may do. A role cannot be given more access than you hold yourself.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Button variant="outline" size="sm" onClick={fetchRoles} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => { setActionError(null); setCreating(true); }}>
            <Plus className="h-4 w-4" />
            New Role
          </Button>
        </div>
      </div>

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

      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          <div className="h-6 w-6 mx-auto mb-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          Loading roles...
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map((role) => (
            <Card key={role.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-foreground capitalize truncate">{role.name}</h3>
                    {role.isSystem && (
                      <Badge variant="secondary" className="text-[10px] gap-1">
                        <Lock className="h-2.5 w-2.5" /> Seeded
                      </Badge>
                    )}
                  </div>
                  {role.description && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground truncate">{role.description}</p>
                  )}
                </div>
              </div>

              <p className="mt-3 text-[11px] text-muted-foreground">
                {role.permissions.includes(SUPERUSER_PERMISSION)
                  ? "Full access — every permission"
                  : `${role.permissions.length} permission${role.permissions.length === 1 ? "" : "s"}`}
              </p>

              <div className="mt-4 flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(role)}>
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Edit Permissions
                </Button>
                {!role.isSystem && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeRole(role)}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <RoleEditorDialog
        mode="edit"
        role={editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={(message) => {
          setEditing(null);
          setActionSuccess(message);
          fetchRoles();
        }}
        onError={setActionError}
      />

      <RoleEditorDialog
        mode="create"
        role={null}
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(message) => {
          setCreating(false);
          setActionSuccess(message);
          fetchRoles();
        }}
        onError={setActionError}
      />
    </div>
  );
}

function RoleEditorDialog({
  mode,
  role,
  open,
  onClose,
  onSaved,
  onError,
}: {
  mode: "create" | "edit";
  role: Role | null;
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const { tokens } = useAuth();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [permissions, setPermissions] = useState<Set<PermissionGrant>>(new Set());
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDialogError(null);
    if (mode === "edit" && role) {
      setName(role.name);
      setDescription(role.description ?? "");
      setPermissions(new Set(role.permissions));
    } else {
      setName("");
      setDescription("");
      setPermissions(new Set());
    }
  }, [open, mode, role]);

  const isSuperuser = permissions.has(SUPERUSER_PERMISSION);

  const toggle = (permission: PermissionGrant) => {
    setPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setDialogError("A role needs a name.");
      return;
    }
    setSaving(true);
    setDialogError(null);
    try {
      const body = {
        name: name.trim(),
        description: description.trim() || undefined,
        permissions: Array.from(permissions),
      };
      if (mode === "create") {
        await api.post("/roles", body, { accessToken: tokens?.accessToken });
        onSaved(`Role "${name}" created.`);
      } else if (role) {
        await api.patch(`/roles/${role.id}`, body, { accessToken: tokens?.accessToken });
        onSaved(`Role "${name}" updated.`);
      }
    } catch (err: any) {
      setDialogError(err?.message || "Failed to save the role.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 text-white">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle>{mode === "create" ? "New Role" : `Edit "${role?.name}"`}</DialogTitle>
              <DialogDescription>
                {role?.isSystem
                  ? "Seeded — permissions are editable, the role itself cannot be deleted."
                  : "Custom role"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {dialogError && (
          <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" /><span>{dialogError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Name *</label>
              <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. senior-cashier" />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Description</label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this role is for" />
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2 text-xs font-medium text-foreground">
              <input
                type="checkbox"
                checked={isSuperuser}
                onChange={() => toggle(SUPERUSER_PERMISSION)}
                className="h-4 w-4 rounded border-input"
              />
              Full access (every permission, current and future)
            </label>
          </div>

          {!isSuperuser && (
            <div className="rounded-xl border border-border p-4 space-y-4 max-h-[45vh] overflow-y-auto">
              {Object.entries(PERMISSION_GROUPS).map(([resource, perms]) => (
                <div key={resource}>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {resource.replace(/_/g, " ")}
                  </p>
                  <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                    {perms.map((p) => (
                      <label key={p} className="flex items-center gap-2 text-xs text-foreground">
                        <input
                          type="checkbox"
                          checked={permissions.has(p)}
                          onChange={() => toggle(p)}
                          className="h-3.5 w-3.5 rounded border-input"
                        />
                        <span className="font-mono">{p}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : mode === "create" ? "Create Role" : "Save Permissions"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
