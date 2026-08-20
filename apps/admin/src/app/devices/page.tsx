"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Tablet, Plus, RefreshCw, X, AlertCircle, CheckCircle2, Clock } from "lucide-react";
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

interface Device {
  id: string;
  branchId: string;
  name: string;
  type: string;
  hardwareId: string | null;
  activatedAt: string | null;
  appVersion: string | null;
  lastSeenAt: string | null;
  isActive: boolean;
  createdAt: string;
}

interface Branch {
  id: string;
  name: string;
  code: string;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function DevicesPage() {
  const { tokens } = useAuth();

  const [devices, setDevices] = useState<Device[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fName, setFName] = useState("");
  const [fBranchId, setFBranchId] = useState("");

  const branchName = useCallback(
    (id: string) => branches.find((b) => b.id === id)?.name ?? "—",
    [branches],
  );

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    setActionError(null);
    try {
      const rows = await api.get<Device[]>("/devices", { accessToken: tokens?.accessToken });
      setDevices(rows ?? []);
    } catch (err: any) {
      setActionError(err?.message || "Failed to load devices from the API.");
    } finally {
      setLoading(false);
    }
  }, [tokens]);

  useEffect(() => {
    if (!tokens?.accessToken) return;
    api
      .get<{ items: Branch[] }>("/branches", { accessToken: tokens.accessToken })
      .then((res) => {
        const list = (res as any)?.items ?? res ?? [];
        setBranches(list);
        if (list.length > 0 && !fBranchId) setFBranchId(list[0].id);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens]);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fName.trim() || !fBranchId) {
      setActionError("Name and branch are required.");
      return;
    }
    setSubmitting(true);
    setActionError(null);
    try {
      await api.post(
        "/devices",
        { name: fName.trim(), branchId: fBranchId },
        { accessToken: tokens?.accessToken },
      );
      setActionSuccess(`Terminal "${fName}" registered.`);
      setIsModalOpen(false);
      setFName("");
      fetchDevices();
    } catch (err: any) {
      setActionError(err?.message || "Failed to register the terminal.");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (device: Device) => {
    setActionError(null);
    try {
      await api.patch(
        `/devices/${device.id}`,
        { isActive: !device.isActive },
        { accessToken: tokens?.accessToken },
      );
      fetchDevices();
    } catch (err: any) {
      setActionError(err?.message || "Failed to update the terminal.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">POS Terminals</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Devices registered to sign in and sync against this business.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={fetchDevices} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => { setActionError(null); setIsModalOpen(true); }}>
            <Plus className="h-4 w-4" />
            Register Terminal
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

      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            <div className="h-6 w-6 mx-auto mb-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Loading terminals...
          </div>
        ) : devices.length === 0 ? (
          <div className="py-16 text-center">
            <Tablet className="mx-auto h-12 w-12 text-muted-foreground/30" />
            <h3 className="mt-4 text-sm font-semibold text-foreground">No terminals registered</h3>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Register the first one to let a till sign in and sync.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3.5 font-medium">Name</th>
                  <th className="px-4 py-3.5 font-medium">Branch</th>
                  <th className="px-4 py-3.5 font-medium">App Version</th>
                  <th className="px-4 py-3.5 font-medium">Last Seen</th>
                  <th className="px-4 py-3.5 text-center font-medium">Status</th>
                  <th className="px-4 py-3.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {devices.map((device) => (
                  <tr key={device.id} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3.5 font-semibold text-foreground">{device.name}</td>
                    <td className="px-4 py-3.5 text-muted-foreground">{branchName(device.branchId)}</td>
                    <td className="px-4 py-3.5 font-mono text-[11px] text-muted-foreground">
                      {device.appVersion ?? "—"}
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {timeAgo(device.lastSeenAt)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <Badge variant={device.isActive ? "success" : "secondary"}>
                        {device.isActive ? "Active" : "Deactivated"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <Button variant="outline" size="sm" onClick={() => toggleActive(device)}>
                        {device.isActive ? "Deactivate" : "Reactivate"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
                <Tablet className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle>Register Terminal</DialogTitle>
                <DialogDescription>Activates immediately — no separate code to redeem.</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {actionError && (
            <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" /><span>{actionError}</span>
            </div>
          )}

          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Terminal Name *</label>
              <Input required value={fName} onChange={(e) => setFName(e.target.value)} placeholder="e.g. Counter 1" />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Branch *</label>
              <select
                required
                value={fBranchId}
                onChange={(e) => setFBranchId(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">— Select branch —</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
                ))}
              </select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Registering..." : "Register"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
