"use client";

import React, { useState } from "react";
import {
  Boxes,
  ArrowDownRight,
  ArrowUpRight,
  RefreshCw,
  AlertTriangle,
  History,
  GitBranch,
} from "lucide-react";

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
  {
    sku: "PVC-ELB-001",
    name: "PVC 90° Elbow 1\" High Pressure",
    sharjahStock: 350,
    dubaiStock: 100,
    totalStock: 450,
    reorderLevel: 100,
    status: "OK",
  },
  {
    sku: "EL-CBL-3CX25",
    name: "Ducab 3-Core 2.5mm² Flexible Copper Cable (100m Roll)",
    sharjahStock: 25,
    dubaiStock: 10,
    totalStock: 35,
    reorderLevel: 50,
    status: "LOW_STOCK",
  },
  {
    sku: "PNT-JOT-MATT-18L",
    name: "Jotun Fenomastic Pure Colours Matt Interior Paint 18L",
    sharjahStock: 30,
    dubaiStock: 12,
    totalStock: 42,
    reorderLevel: 20,
    status: "OK",
  },
  {
    sku: "SAN-ANG-VLV",
    name: "Grohe 1/2\" Chrome Angle Valve with Filter",
    sharjahStock: 80,
    dubaiStock: 15,
    totalStock: 95,
    reorderLevel: 40,
    status: "OK",
  },
];

const SAMPLE_LEDGER = [
  {
    id: "tx-1",
    time: "10 mins ago",
    branch: "SHJ",
    type: "SALE",
    sku: "PVC-ELB-001",
    qty: -15,
    balanceAfter: 350,
    ref: "INV-SHJ-2026-000142",
  },
  {
    id: "tx-2",
    time: "45 mins ago",
    branch: "DXB",
    type: "TRANSFER_IN",
    sku: "EL-CBL-3CX25",
    qty: +5,
    balanceAfter: 10,
    ref: "TRF-2026-000008",
  },
  {
    id: "tx-3",
    time: "2 hours ago",
    branch: "SHJ",
    type: "PURCHASE_GRN",
    sku: "PNT-JOT-MATT-18L",
    qty: +20,
    balanceAfter: 30,
    ref: "GRN-2026-000034",
  },
];

export default function InventoryPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-[--color-fg]">
              Multi-Branch Inventory
            </h1>
            <span className="rounded-full bg-[--color-brand]/10 px-2.5 py-0.5 text-xs font-semibold text-[--color-brand]">
              Append-Only Ledger
            </span>
          </div>
          <p className="mt-1 text-xs text-[--color-muted]">
            Real-time stock balance across Sharjah and Dubai branches. Updates are audited through immutable database triggers.
          </p>
        </div>
      </div>

      {/* Stock Overview Table */}
      <div className="overflow-hidden rounded-xl border border-[--color-border] bg-[--color-surface] shadow-sm">
        <div className="border-b border-[--color-border] bg-[--color-bg] px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-[--color-fg]">
            <Boxes className="h-4 w-4 text-[--color-brand]" />
            <span>Branch Stock Balances</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[--color-border] bg-[--color-surface] font-medium text-[--color-muted]">
              <tr>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Product Name</th>
                <th className="px-4 py-3 text-right">Sharjah (SHJ)</th>
                <th className="px-4 py-3 text-right">Dubai (DXB)</th>
                <th className="px-4 py-3 text-right">Total Units</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[--color-border]">
              {SAMPLE_INVENTORY.map((row) => (
                <tr key={row.sku} className="hover:bg-[--color-bg]/50 transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-[--color-brand]">
                    {row.sku}
                  </td>
                  <td className="px-4 py-3 font-medium text-[--color-fg]">
                    {row.name}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-medium">
                    {row.sharjahStock}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-medium">
                    {row.dubaiStock}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-[--color-fg]">
                    {row.totalStock}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {row.status === "LOW_STOCK" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[--color-warning]/10 px-2 py-0.5 text-[10px] font-semibold text-[--color-warning]">
                        <AlertTriangle className="h-3 w-3" />
                        Low Stock
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-[--color-success]/10 px-2 py-0.5 text-[10px] font-semibold text-[--color-success]">
                        In Stock
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ledger Stream Table */}
      <div className="overflow-hidden rounded-xl border border-[--color-border] bg-[--color-surface] shadow-sm">
        <div className="border-b border-[--color-border] bg-[--color-bg] px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-[--color-fg]">
            <History className="h-4 w-4 text-[--color-brand]" />
            <span>Recent Stock Movement Ledger (Immutable)</span>
          </div>
          <span className="text-[11px] text-[--color-muted]">
            inventory_transactions
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="border-b border-[--color-border] bg-[--color-surface] font-medium text-[--color-muted]">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Branch</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3 text-right">Movement</th>
                <th className="px-4 py-3 text-right">Balance After</th>
                <th className="px-4 py-3">Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[--color-border]">
              {SAMPLE_LEDGER.map((tx) => (
                <tr key={tx.id} className="hover:bg-[--color-bg]/50 transition-colors">
                  <td className="px-4 py-3 text-[--color-muted]">{tx.time}</td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-[--color-brand]/10 px-1.5 py-0.5 text-[11px] font-bold text-[--color-brand]">
                      {tx.branch}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-semibold text-[--color-fg]">{tx.type}</td>
                  <td className="px-4 py-3 text-[--color-muted]">{tx.sku}</td>
                  <td
                    className={`px-4 py-3 text-right font-bold ${
                      tx.qty < 0 ? "text-[--color-danger]" : "text-[--color-success]"
                    }`}
                  >
                    {tx.qty > 0 ? `+${tx.qty}` : tx.qty}
                  </td>
                  <td className="px-4 py-3 text-right text-[--color-fg]">{tx.balanceAfter}</td>
                  <td className="px-4 py-3 text-[--color-muted]">{tx.ref}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
