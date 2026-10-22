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
import {
  Table, TableBody, TableContainer, TableEmpty, TableHead, Th, numericCell,
} from "@/components/ui/data-table";
import { MobileEmpty, MobileList, MobileRow } from "@/components/ui/mobile-list";
import { SelectField } from "@/components/ui/select";
import { formatMoney } from "@/lib/format";
import { useTenantSettings } from "@/lib/tenant-settings";
import { cn } from "@/lib/utils";
import { Field, Notice, PageHeader, errorText } from "../shared";

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

  const settings = useTenantSettings();
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

      <MobileList loading={loading} empty={<MobileEmpty icon={TicketPercent} title="No promo codes yet" />}>
        {coupons.map((c) => (
          <MobileRow
            key={c.id}
            title={<span className="font-mono">{c.code}</span>}
            subtitle={c.type === "percent" ? `${Number(c.value)}% off` : c.type === "free_shipping" ? "Free delivery" : "Fixed amount"}
            badge={<Badge variant={c.isActive ? "success" : "secondary"}>{c.isActive ? "On" : "Off"}</Badge>}
            fields={[
              { label: "Gives", value: c.type === "percent" ? `${Number(c.value)}% off` : c.type === "free_shipping" ? "Free delivery" : "Fixed amount (not usable online)" },
              {
                label: `Min. spend (excl. ${settings.tax.label})`,
                value: c.minSubtotal === "0.0000" ? "—" : formatMoney(c.minSubtotal, { currency: settings.currency.base }),
                numeric: true,
              },
              { label: "Used", value: `${c.usedCount}${c.maxUses ? ` / ${c.maxUses}` : ""}`, numeric: true },
              { label: "Valid until", value: c.validTo ? new Date(c.validTo).toLocaleDateString("en-AE") : "No end" },
            ]}
            actions={
              mayWrite ? (
                <Button variant="outline" size="sm" onClick={() => void toggle(c)} aria-pressed={c.isActive}>
                  {c.isActive ? "Turn off" : "Turn on"}
                </Button>
              ) : undefined
            }
          />
        ))}
      </MobileList>

      <Card className="hidden overflow-hidden md:block">
        <TableContainer>
          <Table>
            <TableHead>
              <tr>
                <Th>Code</Th>
                <Th>Gives</Th>
                <Th align="right">Minimum spend (excl. {settings.tax.label})</Th>
                <Th align="right">Used</Th>
                <Th>Valid until</Th>
                <Th align="center">Active</Th>
              </tr>
            </TableHead>
            <TableBody
              columns={6}
              loading={loading}
              empty={<TableEmpty columns={6} icon={TicketPercent} title="No promo codes yet" />}
            >
              {coupons.map((c) => (
                <tr key={c.id} className="hover:bg-secondary/30">
                  <td className="px-4 py-3.5 font-mono font-semibold text-foreground">{c.code}</td>
                  <td className="px-4 py-3.5">{c.type === "percent" ? `${Number(c.value)}% off` : c.type === "free_shipping" ? "Free delivery" : "Fixed amount (not usable online)"}</td>
                  <td className={cn("px-4 py-3.5", numericCell)}>{c.minSubtotal === "0.0000" ? "—" : formatMoney(c.minSubtotal, { currency: settings.currency.base })}</td>
                  <td className={cn("px-4 py-3.5", numericCell)}>{c.usedCount}{c.maxUses ? ` / ${c.maxUses}` : ""}</td>
                  <td className="px-4 py-3.5 tabular-nums">{c.validTo ? new Date(c.validTo).toLocaleDateString("en-AE") : "No end"}</td>
                  <td className="px-4 py-3.5 text-center">
                    <button
                      type="button"
                      disabled={!mayWrite}
                      onClick={() => void toggle(c)}
                      aria-label={`${c.isActive ? "Turn off" : "Turn on"} ${c.code}`}
                      aria-pressed={c.isActive}
                      className="cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                    >
                      <Badge variant={c.isActive ? "success" : "secondary"}>{c.isActive ? "On" : "Off"}</Badge>
                    </button>
                  </td>
                </tr>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
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
                    <SelectField
                      size="sm"
                      label="Gives"
                      value={form.type}
                      onValueChange={(v) => setForm({ ...form, type: v })}
                      options={[{ value: "percent", label: "A percentage off" }, { value: "free_shipping", label: "Free delivery" }]}
                    />
                  </Field>
                  {form.type === "percent" && <Field label="Percent off"><Input required inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></Field>}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={`Minimum spend (excl. ${settings.tax.label})`}><Input inputMode="decimal" value={form.minSubtotal} onChange={(e) => setForm({ ...form, minSubtotal: e.target.value })} /></Field>
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
