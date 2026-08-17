"use client";

import React, { useState } from "react";
import { Search, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

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
  { id: "c1", name: "Eng. Tariq Al-Nuaimi", company: "Al Falaj Building Contracting LLC", phone: "+971 50 123 4567", type: "WHOLESALE", creditLimit: "50,000.00", creditBalance: "12,450.00", trn: "100234567800003" },
  { id: "c2", name: "Mohammad Rashid", company: "Bin Hamoodah MEP Contracting", phone: "+971 55 987 6543", type: "WHOLESALE", creditLimit: "100,000.00", creditBalance: "48,200.00", trn: "100345678900003" },
  { id: "c3", name: "Salim Khan", company: "Khan Electromechanical Works", phone: "+971 56 444 8811", type: "RETAIL", creditLimit: "10,000.00", creditBalance: "1,200.00" },
];

const TYPE_COLORS: Record<string, string> = {
  WHOLESALE: "from-blue-500 to-indigo-600",
  RETAIL: "from-emerald-500 to-teal-600",
  VIP: "from-amber-500 to-orange-600",
};

export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const filtered = SAMPLE_CUSTOMERS.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.company.toLowerCase().includes(search.toLowerCase()) ||
    c.phone.includes(search),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Customers & Credit Accounts</h1>
            <Badge variant="secondary">Wholesale & Retail</Badge>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">Customer profiles, wholesale price list assignments, TRN registration, and credit limits.</p>
        </div>
        <Button size="sm">
          <Plus className="h-4 w-4" />
          Add Customer
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by customer name, company, or mobile number..." className="pl-10 h-10 bg-secondary/30" />
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
              <tr>
                <th className="px-4 py-3.5 font-medium">Customer & Contact</th>
                <th className="px-4 py-3.5 font-medium">Company & TRN</th>
                <th className="px-4 py-3.5 font-medium">Tier</th>
                <th className="px-4 py-3.5 text-right font-medium">Credit Limit (AED)</th>
                <th className="px-4 py-3.5 text-right font-medium">Outstanding (AED)</th>
                <th className="px-4 py-3.5 text-center font-medium">Credit Usage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((c) => {
                const balNum = parseFloat(c.creditBalance.replace(/,/g, ""));
                const limitNum = parseFloat(c.creditLimit.replace(/,/g, ""));
                const usagePercent = (balNum / limitNum) * 100;
                return (
                  <tr key={c.id} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className={cn("bg-gradient-to-br text-white text-[10px] font-bold", TYPE_COLORS[c.type])}>
                            {c.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                          <span className="font-semibold text-foreground">{c.name}</span>
                          <span className="text-[11px] text-muted-foreground font-mono">{c.phone}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">{c.company}</span>
                        {c.trn && <span className="text-[10px] text-muted-foreground font-mono">TRN: {c.trn}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <Badge variant={c.type === "WHOLESALE" ? "default" : c.type === "VIP" ? "warning" : "secondary"} className="text-[10px]">
                        {c.type}
                      </Badge>
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono font-medium text-foreground">{c.creditLimit}</td>
                    <td className="px-4 py-3.5 text-right font-mono font-bold gradient-text">{c.creditBalance}</td>
                    <td className="px-4 py-3.5 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-20 h-2 rounded-full bg-border overflow-hidden">
                          <div
                            className={cn("h-full rounded-full transition-all duration-500", usagePercent > 80 ? "bg-red-500" : usagePercent > 50 ? "bg-amber-500" : "bg-emerald-500")}
                            style={{ width: `${Math.min(usagePercent, 100)}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground w-8">{Math.round(usagePercent)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
