"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Plus, TicketPercent } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { usePermission } from "@/lib/require-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Loading, Notice, PageHeader, errorText, money, selectClass } from "../shared";

interface Coupon {
  id: string;
  code: string;
  type: string;
  value: string;
  minSubtotal: string;
  maxUses: number | null;
  usedCount: number;
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean;
}

const EMPTY = { code: "", type: "percent", value: "10", minSubtotal: "0", maxUses: "", validTo: "" };

export default function CouponsPage() {
  const { tokens, user } = useAuth();
  const mayWrite = usePermission("storefront:write");
  const mayDiscount = usePermission("sale:discount");
  const auth = { accessToken: tokens?.accessToken };

  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCoupons(await api.get<Coupon[]>("/storefront-admin/coupons", auth));
    } catch (err) {
      setError(errorText(err, "Failed to load promo codes."));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      await api.post(
        "/storefront-admin/coupons",
        {
          code: form.code,
          type: form.type,
          value: form.type === "percent" ? form.value : "0",
          minSubtotal: form.minSubtotal || "0",
          ...(form.maxUses ? { maxUses: Number(form.maxUses) } : {}),
          ...(form.validTo ? { validTo: new Date(`${form.validTo}T23:59:59`).toISOString() } : {}),
        },
        auth,
      );
      setForm(null);
      void load();
    } catch (err) {
      setError(errorText(err, "Could not create the code."));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(c: Coupon) {
    try {
      await api.patch(`/storefront-admin/coupons/${c.id}`, { isActive: !c.isActive }, auth);
      void load();
    } catch (err) {
      setError(errorText(err, "Could not change the code."));
    }
  }

  const ceiling = (user as { abac?: { maxDiscountPercent?: string } } | null)?.abac?.maxDiscountPercent;

  return (
    <div className="space-y-6">
      <PageHeader title="Promo Codes" description="Discount codes shoppers enter at checkout. Applied per item, never to delivery.">
        {mayWrite && mayDiscount && (
          <Button size="sm" onClick={() => setForm({ ...EMPTY })}><Plus className="h-4 w-4" /> New code</Button>
        )}
      </PageHeader>

      {error && !form && <Notice kind="error" message={error} onClose={() => setError(null)} />}

      <Card className="overflow-hidden">
        {loading ? (
          <Loading label="Loading promo codes..." />
        ) : coupons.length === 0 ? (
          <div className="py-16 text-center"><TicketPercent className="mx-auto h-12 w-12 text-muted-foreground/30" /><h3 className="mt-4 text-sm font-semibold">No promo codes yet</h3></div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
              <tr><th className="px-4 py-3.5 font-medium">Code</th><th className="px-4 py-3.5 font-medium">Gives</th><th className="px-4 py-3.5 font-medium">Minimum spend</th><th className="px-4 py-3.5 font-medium">Used</th><th className="px-4 py-3.5 font-medium">Valid until</th><th className="px-4 py-3.5 text-center font-medium">Active</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {coupons.map((c) => (
                <tr key={c.id} className="hover:bg-secondary/30">
                  <td className="px-4 py-3.5 font-mono font-semibold text-foreground">{c.code}</td>
                  <td className="px-4 py-3.5">{c.type === "percent" ? `${Number(c.value)}% off` : c.type === "free_shipping" ? "Free delivery" : "Fixed amount (not usable online)"}</td>
                  <td className="px-4 py-3.5">{c.minSubtotal === "0.0000" ? "—" : `${money(c.minSubtotal)} excl. VAT`}</td>
                  <td className="px-4 py-3.5">{c.usedCount}{c.maxUses ? ` / ${c.maxUses}` : ""}</td>
                  <td className="px-4 py-3.5">{c.validTo ? new Date(c.validTo).toLocaleDateString("en-AE") : "No end"}</td>
                  <td className="px-4 py-3.5 text-center">
                    <button disabled={!mayWrite} onClick={() => void toggle(c)} className="cursor-pointer disabled:cursor-default">
                      <Badge variant={c.isActive ? "success" : "secondary"}>{c.isActive ? "On" : "Off"}</Badge>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-md">
          {form && (
            <>
              <DialogHeader>
                <DialogTitle>New promo code</DialogTitle>
                <DialogDescription>
                  {ceiling ? `You can create codes up to ${Number(ceiling)}% off — your own discount limit.` : "Codes are capped at your own discount limit."}
                </DialogDescription>
              </DialogHeader>
              {error && <Notice kind="error" message={error} onClose={() => setError(null)} />}
              <form onSubmit={create} className="space-y-4">
                <Field label="Code"><Input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="WELCOME10" /></Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Gives">
                    <select className={selectClass} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                      <option value="percent">A percentage off</option>
                      <option value="free_shipping">Free delivery</option>
                    </select>
                  </Field>
                  {form.type === "percent" && <Field label="Percent off"><Input required inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></Field>}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Minimum spend (excl. VAT)"><Input inputMode="decimal" value={form.minSubtotal} onChange={(e) => setForm({ ...form, minSubtotal: e.target.value })} /></Field>
                  <Field label="Total uses allowed"><Input inputMode="numeric" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} placeholder="Unlimited" /></Field>
                </div>
                <Field label="Valid until"><Input type="date" value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.target.value })} /></Field>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setForm(null)}>Cancel</Button>
                  <Button type="submit" disabled={saving}>{saving ? "Creating..." : "Create code"}</Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
