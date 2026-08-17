"use client";

import React from "react";
import { Boxes, AlertTriangle, History, ArrowDown, ArrowUp, ArrowRightLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface StockRow {
  sku: string;
  name: string;
  sharjahStock: number;
  dubaiStock: number;
  totalStock: number;
  reorderLevel: number;
  status: "OK" | "LOW_STOCK" | "OUT_OF_STOCK";
}

const SAMPLE_INVENTORY: StockRow[] = [
  { sku: "PVC-ELB-001", name: 'PVC 90° Elbow 1" High Pressure', sharjahStock: 350, dubaiStock: 100, totalStock: 450, reorderLevel: 100, status: "OK" },
  { sku: "EL-CBL-3CX25", name: "Ducab 3-Core 2.5mm² Flexible Copper Cable (100m Roll)", sharjahStock: 25, dubaiStock: 10, totalStock: 35, reorderLevel: 50, status: "LOW_STOCK" },
  { sku: "PNT-JOT-MATT-18L", name: "Jotun Fenomastic Pure Colours Matt Interior Paint 18L", sharjahStock: 30, dubaiStock: 12, totalStock: 42, reorderLevel: 20, status: "OK" },
  { sku: "SAN-ANG-VLV", name: 'Grohe 1/2" Chrome Angle Valve with Filter', sharjahStock: 80, dubaiStock: 15, totalStock: 95, reorderLevel: 40, status: "OK" },
];

const SAMPLE_LEDGER = [
  { id: "tx-1", time: "10 mins ago", branch: "SHJ", type: "SALE", sku: "PVC-ELB-001", qty: -15, balanceAfter: 350, ref: "INV-SHJ-2026-000142" },
  { id: "tx-2", time: "45 mins ago", branch: "DXB", type: "TRANSFER_IN", sku: "EL-CBL-3CX25", qty: +5, balanceAfter: 10, ref: "TRF-2026-000008" },
  { id: "tx-3", time: "2 hours ago", branch: "SHJ", type: "PURCHASE_GRN", sku: "PNT-JOT-MATT-18L", qty: +20, balanceAfter: 30, ref: "GRN-2026-000034" },
];

export default function InventoryPage() {
  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Multi-Branch Inventory</h1>
          <Badge variant="secondary">Append-Only Ledger</Badge>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">Real-time stock balance across Sharjah and Dubai branches. Updates are audited through immutable database triggers.</p>
      </div>

      {/* ── Stock Table ── */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-0 border-b border-border bg-secondary/30">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
              <Boxes className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-sm">Branch Stock Balances</CardTitle>
              <CardDescription className="text-[11px]">Live quantities per warehouse</CardDescription>
            </div>
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">SKU</th>
                <th className="px-4 py-3 font-medium">Product Name</th>
                <th className="px-4 py-3 text-right font-medium">Sharjah (SHJ)</th>
                <th className="px-4 py-3 text-right font-medium">Dubai (DXB)</th>
                <th className="px-4 py-3 text-right font-medium">Total Units</th>
                <th className="px-4 py-3 text-center font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {SAMPLE_INVENTORY.map((row) => {
                const pct = Math.min((row.totalStock / (row.reorderLevel * 5)) * 100, 100);
                return (
                  <tr key={row.sku} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3.5 font-mono font-bold text-primary">{row.sku}</td>
                    <td className="px-4 py-3.5 font-medium text-foreground">{row.name}</td>
                    <td className="px-4 py-3.5 text-right font-mono font-medium">{row.sharjahStock}</td>
                    <td className="px-4 py-3.5 text-right font-mono font-medium">{row.dubaiStock}</td>
                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-border overflow-hidden hidden sm:block">
                          <div
                            className={cn("h-full rounded-full transition-all", row.status === "LOW_STOCK" ? "bg-amber-500" : "bg-emerald-500")}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="font-mono font-bold text-foreground">{row.totalStock}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      {row.status === "LOW_STOCK" ? (
                        <Badge variant="warning" className="gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          Low Stock
                        </Badge>
                      ) : (
                        <Badge variant="success">In Stock</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Ledger ── */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-0 border-b border-border bg-secondary/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                <History className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Recent Stock Movement Ledger</CardTitle>
                <CardDescription className="text-[11px]">Immutable transaction log</CardDescription>
              </div>
            </div>
            <Badge variant="outline" className="text-[10px] font-mono">inventory_transactions</Badge>
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Branch</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">SKU</th>
                <th className="px-4 py-3 text-right font-medium">Movement</th>
                <th className="px-4 py-3 text-right font-medium">Balance After</th>
                <th className="px-4 py-3 font-medium">Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {SAMPLE_LEDGER.map((tx) => (
                <tr key={tx.id} className="hover:bg-secondary/30 transition-colors">
                  <td className="px-4 py-3.5 text-muted-foreground">{tx.time}</td>
                  <td className="px-4 py-3.5">
                    <Badge variant="secondary" className="text-[10px] font-bold">{tx.branch}</Badge>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1.5 font-semibold text-foreground">
                      {tx.qty < 0 ? <ArrowDown className="h-3 w-3 text-red-500" /> : <ArrowUp className="h-3 w-3 text-emerald-500" />}
                      {tx.type}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-muted-foreground">{tx.sku}</td>
                  <td className={cn("px-4 py-3.5 text-right font-bold", tx.qty < 0 ? "text-red-500" : "text-emerald-500")}>
                    {tx.qty > 0 ? `+${tx.qty}` : tx.qty}
                  </td>
                  <td className="px-4 py-3.5 text-right text-foreground">{tx.balanceAfter}</td>
                  <td className="px-4 py-3.5 text-muted-foreground">{tx.ref}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
