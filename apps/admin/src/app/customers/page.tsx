"use client";

import React, { useState } from "react";
import {
  Search,
  Plus,
} from "lucide-react";

interface Customer {
  id: string;
  name: string;
  company: string;
  phone: string;
  type: "RETAIL" | "WHOLESALE" | "VIP";
  creditLimit: string;
  creditBalance: string;
  trn?: string;
}

const SAMPLE_CUSTOMERS: Customer[] = [
  {
    id: "c1",
    name: "Eng. Tariq Al-Nuaimi",
    company: "Al Falaj Building Contracting LLC",
    phone: "+971 50 123 4567",
    type: "WHOLESALE",
    creditLimit: "50,000.00",
    creditBalance: "12,450.00",
    trn: "100234567800003",
  },
  {
    id: "c2",
    name: "Mohammad Rashid",
    company: "Bin Hamoodah MEP Contracting",
    phone: "+971 55 987 6543",
    type: "WHOLESALE",
    creditLimit: "100,000.00",
    creditBalance: "48,200.00",
    trn: "100345678900003",
  },
  {
    id: "c3",
    name: "Salim Khan",
    company: "Khan Electromechanical Works",
    phone: "+971 56 444 8811",
    type: "RETAIL",
    creditLimit: "10,000.00",
    creditBalance: "1,200.00",
  },
];

export default function CustomersPage() {
  const [search, setSearch] = useState("");

  const filtered = SAMPLE_CUSTOMERS.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.company.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search),
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-[--color-fg]">
              Customers & Credit Accounts
            </h1>
            <span className="rounded-full bg-[--color-brand]/10 px-2.5 py-0.5 text-xs font-semibold text-[--color-brand]">
              Wholesale & Retail
            </span>
          </div>
          <p className="mt-1 text-xs text-[--color-muted]">
            Customer profiles, wholesale price list assignments, TRN registration, and credit limits.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button className="flex items-center gap-1.5 rounded-lg bg-[--color-brand] px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-90 transition-opacity cursor-pointer">
            <Plus className="h-4 w-4" />
            <span>Add Customer</span>
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[--color-muted]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by customer name, company, or mobile number..."
            className="w-full rounded-lg border border-[--color-border] bg-[--color-surface] py-2 pl-9 pr-3 text-xs text-[--color-fg] placeholder-[--color-muted] focus:border-[--color-brand] focus:outline-none focus:ring-1 focus:ring-[--color-brand]"
          />
        </div>
      </div>

      {/* Customers Table */}
      <div className="overflow-hidden rounded-xl border border-[--color-border] bg-[--color-surface] shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[--color-border] bg-[--color-bg] font-medium text-[--color-muted]">
              <tr>
                <th className="px-4 py-3.5">Customer & Contact</th>
                <th className="px-4 py-3.5">Company & TRN</th>
                <th className="px-4 py-3.5">Tier</th>
                <th className="px-4 py-3.5 text-right">Credit Limit (AED)</th>
                <th className="px-4 py-3.5 text-right">Outstanding Balance (AED)</th>
                <th className="px-4 py-3.5 text-center">Credit Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[--color-border]">
              {filtered.map((c) => {
                const balNum = parseFloat(c.creditBalance.replace(/,/g, ""));
                const limitNum = parseFloat(c.creditLimit.replace(/,/g, ""));
                const usagePercent = (balNum / limitNum) * 100;

                return (
                  <tr key={c.id} className="hover:bg-[--color-bg]/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-semibold text-[--color-fg]">{c.name}</span>
                        <span className="text-[11px] text-[--color-muted] font-mono">{c.phone}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium text-[--color-fg]">{c.company}</span>
                        {c.trn && (
                          <span className="text-[10px] text-[--color-muted] font-mono">
                            TRN: {c.trn}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-[--color-brand]/10 px-2 py-0.5 font-bold text-[10px] text-[--color-brand]">
                        {c.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-medium text-[--color-fg]">
                      {c.creditLimit}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-[--color-brand]">
                      {c.creditBalance}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <div className="w-16 h-1.5 rounded-full bg-[--color-border] overflow-hidden">
                          <div
                            className={`h-full ${
                              usagePercent > 80
                                ? "bg-[--color-danger]"
                                : usagePercent > 50
                                  ? "bg-[--color-warning]"
                                  : "bg-[--color-success]"
                            }`}
                            style={{ width: `${Math.min(usagePercent, 100)}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-mono text-[--color-muted]">
                          {Math.round(usagePercent)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
