"use client";

import React, { useState } from "react";
import {
  ShoppingCart,
  Search,
  Calendar,
  FileText,
  CreditCard,
  Banknote,
  Eye,
  CheckCircle2,
} from "lucide-react";

interface SaleRecord {
  invoiceNumber: string;
  customer: string;
  branch: string;
  date: string;
  paymentMethod: "CASH" | "CARD" | "SPLIT" | "CREDIT";
  subtotal: string;
  vat: string;
  total: string;
  status: "COMPLETED" | "PARTIAL_RETURN" | "VOID";
}

const SAMPLE_SALES: SaleRecord[] = [
  {
    invoiceNumber: "INV-SHJ-2026-000142",
    customer: "Al Falaj Building Contracting LLC",
    branch: "SHJ",
    date: "Today, 10:45 AM",
    paymentMethod: "CASH",
    subtotal: "540.00",
    vat: "27.00",
    total: "567.00",
    status: "COMPLETED",
  },
  {
    invoiceNumber: "INV-DXB-2026-000098",
    customer: "Walk-in Retail Customer",
    branch: "DXB",
    date: "Today, 10:12 AM",
    paymentMethod: "CARD",
    subtotal: "140.00",
    vat: "7.00",
    total: "147.00",
    status: "COMPLETED",
  },
  {
    invoiceNumber: "INV-SHJ-2026-000141",
    customer: "Bin Hamoodah MEP Contracting",
    branch: "SHJ",
    date: "Today, 09:30 AM",
    paymentMethod: "CREDIT",
    subtotal: "2,450.00",
    vat: "122.50",
    total: "2,572.50",
    status: "COMPLETED",
  },
  {
    invoiceNumber: "INV-DXB-2026-000097",
    customer: "Walk-in Retail Customer",
    branch: "DXB",
    date: "Yesterday, 07:45 PM",
    paymentMethod: "CASH",
    subtotal: "45.00",
    vat: "2.25",
    total: "47.25",
    status: "COMPLETED",
  },
];

export default function SalesPage() {
  const [search, setSearch] = useState("");

  const filtered = SAMPLE_SALES.filter(
    (s) =>
      s.invoiceNumber.toLowerCase().includes(search.toLowerCase()) ||
      s.customer.toLowerCase().includes(search.toLowerCase()) ||
      s.branch.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-[--color-fg]">
              Sales & Tax Invoices
            </h1>
            <span className="rounded-full bg-[--color-brand]/10 px-2.5 py-0.5 text-xs font-semibold text-[--color-brand]">
              UAE FTA Compliant
            </span>
          </div>
          <p className="mt-1 text-xs text-[--color-muted]">
            Finalized sales transactions from POS terminals and WhatsApp orders with snapshot item pricing and VAT records.
          </p>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[--color-muted]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoice number, customer name, branch..."
            className="w-full rounded-lg border border-[--color-border] bg-[--color-surface] py-2 pl-9 pr-3 text-xs text-[--color-fg] placeholder-[--color-muted] focus:border-[--color-brand] focus:outline-none focus:ring-1 focus:ring-[--color-brand]"
          />
        </div>
      </div>

      {/* Sales Invoices Table */}
      <div className="overflow-hidden rounded-xl border border-[--color-border] bg-[--color-surface] shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[--color-border] bg-[--color-bg] font-medium text-[--color-muted]">
              <tr>
                <th className="px-4 py-3.5">Invoice #</th>
                <th className="px-4 py-3.5">Customer</th>
                <th className="px-4 py-3.5">Branch</th>
                <th className="px-4 py-3.5">Date & Time</th>
                <th className="px-4 py-3.5">Payment</th>
                <th className="px-4 py-3.5 text-right">Subtotal</th>
                <th className="px-4 py-3.5 text-right">VAT (5%)</th>
                <th className="px-4 py-3.5 text-right">Total (AED)</th>
                <th className="px-4 py-3.5 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[--color-border]">
              {filtered.map((sale) => (
                <tr key={sale.invoiceNumber} className="hover:bg-[--color-bg]/50 transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-[--color-brand]">
                    {sale.invoiceNumber}
                  </td>
                  <td className="px-4 py-3 font-medium text-[--color-fg]">
                    {sale.customer}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-[--color-brand]/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-[--color-brand]">
                      {sale.branch}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[--color-muted]">{sale.date}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 font-medium text-[--color-fg]">
                      {sale.paymentMethod === "CASH" ? (
                        <Banknote className="h-3.5 w-3.5 text-[--color-success]" />
                      ) : (
                        <CreditCard className="h-3.5 w-3.5 text-[--color-brand]" />
                      )}
                      {sale.paymentMethod}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[--color-muted]">
                    {sale.subtotal}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[--color-muted]">
                    {sale.vat}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-[--color-fg]">
                    {sale.total}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center rounded-full bg-[--color-success]/10 px-2 py-0.5 text-[10px] font-semibold text-[--color-success]">
                      {sale.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
