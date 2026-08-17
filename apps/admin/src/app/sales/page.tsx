"use client";

import React, { useState } from "react";
import { Search, CreditCard, Banknote, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
  { invoiceNumber: "INV-SHJ-2026-000142", customer: "Al Falaj Building Contracting LLC", branch: "SHJ", date: "Today, 10:45 AM", paymentMethod: "CASH", subtotal: "540.00", vat: "27.00", total: "567.00", status: "COMPLETED" },
  { invoiceNumber: "INV-DXB-2026-000098", customer: "Walk-in Retail Customer", branch: "DXB", date: "Today, 10:12 AM", paymentMethod: "CARD", subtotal: "140.00", vat: "7.00", total: "147.00", status: "COMPLETED" },
  { invoiceNumber: "INV-SHJ-2026-000141", customer: "Bin Hamoodah MEP Contracting", branch: "SHJ", date: "Today, 09:30 AM", paymentMethod: "CREDIT", subtotal: "2,450.00", vat: "122.50", total: "2,572.50", status: "COMPLETED" },
  { invoiceNumber: "INV-DXB-2026-000097", customer: "Walk-in Retail Customer", branch: "DXB", date: "Yesterday, 07:45 PM", paymentMethod: "CASH", subtotal: "45.00", vat: "2.25", total: "47.25", status: "COMPLETED" },
];

const PAYMENT_ICONS: Record<string, React.ReactNode> = {
  CASH: <Banknote className="h-3.5 w-3.5 text-emerald-500" />,
  CARD: <CreditCard className="h-3.5 w-3.5 text-primary" />,
  CREDIT: <Receipt className="h-3.5 w-3.5 text-amber-500" />,
  SPLIT: <CreditCard className="h-3.5 w-3.5 text-violet-500" />,
};

export default function SalesPage() {
  const [search, setSearch] = useState("");
  const filtered = SAMPLE_SALES.filter((s) =>
    s.invoiceNumber.toLowerCase().includes(search.toLowerCase()) ||
    s.customer.toLowerCase().includes(search.toLowerCase()) ||
    s.branch.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Sales & Tax Invoices</h1>
          <Badge variant="secondary">UAE FTA Compliant</Badge>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">Finalized sales transactions from POS terminals and WhatsApp orders with snapshot item pricing and VAT records.</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoice number, customer name, branch..." className="pl-10 h-10 bg-secondary/30" />
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
              <tr>
                <th className="px-4 py-3.5 font-medium">Invoice #</th>
                <th className="px-4 py-3.5 font-medium">Customer</th>
                <th className="px-4 py-3.5 font-medium">Branch</th>
                <th className="px-4 py-3.5 font-medium">Date & Time</th>
                <th className="px-4 py-3.5 font-medium">Payment</th>
                <th className="px-4 py-3.5 text-right font-medium">Subtotal</th>
                <th className="px-4 py-3.5 text-right font-medium">VAT (5%)</th>
                <th className="px-4 py-3.5 text-right font-medium">Total (AED)</th>
                <th className="px-4 py-3.5 text-center font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((sale) => (
                <tr key={sale.invoiceNumber} className="hover:bg-secondary/30 transition-colors">
                  <td className="px-4 py-3.5 font-mono font-bold text-primary">{sale.invoiceNumber}</td>
                  <td className="px-4 py-3.5 font-medium text-foreground">{sale.customer}</td>
                  <td className="px-4 py-3.5">
                    <Badge variant="secondary" className="font-mono text-[10px] font-bold">{sale.branch}</Badge>
                  </td>
                  <td className="px-4 py-3.5 text-muted-foreground">{sale.date}</td>
                  <td className="px-4 py-3.5">
                    <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                      {PAYMENT_ICONS[sale.paymentMethod]}
                      {sale.paymentMethod}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono text-muted-foreground">{sale.subtotal}</td>
                  <td className="px-4 py-3.5 text-right font-mono text-muted-foreground">{sale.vat}</td>
                  <td className="px-4 py-3.5 text-right font-mono font-bold text-foreground">{sale.total}</td>
                  <td className="px-4 py-3.5 text-center">
                    <Badge variant="success">{sale.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
