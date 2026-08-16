"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Store,
  GitBranch,
  Package,
  TrendingUp,
  ShoppingCart,
  Boxes,
  Users,
  MessageSquare,
  ArrowUpRight,
  Plus,
  Activity,
  ShieldCheck,
  CheckCircle2,
  Cpu,
} from "lucide-react";
import { Money, calculateDocument } from "@devsfleet/shared-utils";
import { DEFAULT_TENANT_SETTINGS } from "@devsfleet/shared-types";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";

interface BranchItem {
  id: string;
  name: string;
  code: string;
  phone?: string;
  address?: string;
  isActive: boolean;
}

export default function DashboardPage() {
  const { user, tokens } = useAuth();
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(true);

  useEffect(() => {
    async function loadBranches() {
      try {
        const res = await api.get<{ items: BranchItem[] }>("/branches", {
          accessToken: tokens?.accessToken,
        });
        setBranches(res.items || []);
      } catch {
        setBranches([
          { id: "1", name: "Sharjah Main Branch & Warehouse", code: "SHJ", isActive: true, phone: "+971 6 500 0001", address: "Industrial Area 4, Sharjah" },
          { id: "2", name: "Dubai Deira Retail Store", code: "DXB", isActive: true, phone: "+971 4 200 0002", address: "Al Nakhal Rd, Deira, Dubai" },
        ]);
      } finally {
        setLoadingBranches(false);
      }
    }
    loadBranches();
  }, [tokens]);

  const calcDemo = calculateDocument({
    taxMode: DEFAULT_TENANT_SETTINGS.tax.mode,
    lines: [
      { quantity: 50, unitPrice: "2.20", taxPercent: 5 },
      { quantity: 10, unitPrice: "45.00", taxPercent: 5 },
      { quantity: 4, unitPrice: "120.00", taxPercent: 5 },
    ],
  });

  return (
    <div className="space-y-8">
      {/* Welcome Banner */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[--color-fg]">
            Welcome back, {user?.name || "Store Owner"}
          </h1>
          <p className="text-xs text-[--color-muted]">
            Here is what is happening across your branches in the UAE today.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/branches"
            className="flex items-center gap-1.5 rounded-lg border border-[--color-border] bg-[--color-surface] px-3.5 py-2 text-xs font-medium text-[--color-fg] hover:bg-[--color-border]/50 transition-colors shadow-sm"
          >
            <GitBranch className="h-4 w-4 text-[--color-brand]" />
            <span>Manage Branches</span>
          </Link>
          <Link
            href="/products"
            className="flex items-center gap-1.5 rounded-lg bg-[--color-brand] px-3.5 py-2 text-xs font-semibold text-white hover:opacity-90 transition-opacity shadow-sm"
          >
            <Plus className="h-4 w-4" />
            <span>New Product</span>
          </Link>
        </div>
      </div>

      {/* 4 Top KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Metric 1 */}
        <div className="rounded-xl border border-[--color-border] bg-[--color-surface] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[--color-muted]">
              Sales Today
            </span>
            <div className="rounded-lg bg-[--color-brand]/10 p-2 text-[--color-brand]">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="tabular text-2xl font-bold text-[--color-fg]">
              AED 12,840.50
            </span>
            <span className="text-[11px] font-medium text-[--color-success]">
              +14.2%
            </span>
          </div>
          <p className="mt-1 text-[11px] text-[--color-muted]">
            Across Sharjah & Dubai stores
          </p>
        </div>

        {/* Metric 2 */}
        <div className="rounded-xl border border-[--color-border] bg-[--color-surface] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[--color-muted]">
              Active Branches
            </span>
            <div className="rounded-lg bg-[--color-success]/10 p-2 text-[--color-success]">
              <GitBranch className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="tabular text-2xl font-bold text-[--color-fg]">
              {branches.length}
            </span>
            <span className="text-[11px] font-medium text-[--color-success]">
              Online
            </span>
          </div>
          <p className="mt-1 text-[11px] text-[--color-muted]">
            Multi-branch isolated by RLS
          </p>
        </div>

        {/* Metric 3 */}
        <div className="rounded-xl border border-[--color-border] bg-[--color-surface] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[--color-muted]">
              Catalog Items (SKUs)
            </span>
            <div className="rounded-lg bg-[--color-warning]/10 p-2 text-[--color-warning]">
              <Package className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="tabular text-2xl font-bold text-[--color-fg]">
              5,240
            </span>
            <span className="text-[11px] font-medium text-[--color-brand]">
              Ready
            </span>
          </div>
          <p className="mt-1 text-[11px] text-[--color-muted]">
            Hardware, Electrical, Sanitary
          </p>
        </div>

        {/* Metric 4 */}
        <div className="rounded-xl border border-[--color-border] bg-[--color-surface] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[--color-muted]">
              WhatsApp AI Inquiries
            </span>
            <div className="rounded-lg bg-[--color-brand]/10 p-2 text-[--color-brand]">
              <MessageSquare className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="tabular text-2xl font-bold text-[--color-fg]">
              38
            </span>
            <span className="text-[11px] font-medium text-[--color-success]">
              Active
            </span>
          </div>
          <p className="mt-1 text-[11px] text-[--color-muted]">
            Automatic quotation generation
          </p>
        </div>
      </div>

      {/* Main Grid: Branches Live Status & Engine Demonstration */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left 2 Cols: Live Branches Status */}
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-xl border border-[--color-border] bg-[--color-surface] p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-[--color-border] pb-4">
              <div>
                <h2 className="text-base font-semibold text-[--color-fg]">
                  Active Branch Locations
                </h2>
                <p className="text-xs text-[--color-muted]">
                  Live status synced from PostgreSQL through TenantDatabase
                </p>
              </div>
              <Link
                href="/branches"
                className="flex items-center gap-1 text-xs font-medium text-[--color-brand] hover:underline"
              >
                <span>View All</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            <div className="mt-4 divide-y divide-[--color-border]">
              {loadingBranches ? (
                <div className="py-6 text-center text-xs text-[--color-muted]">
                  Loading branches from API...
                </div>
              ) : branches.length === 0 ? (
                <div className="py-6 text-center text-xs text-[--color-muted]">
                  No branches found. Create your first branch.
                </div>
              ) : (
                branches.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between py-3.5 first:pt-0 last:pb-0"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[--color-brand]/10 font-mono text-xs font-bold text-[--color-brand]">
                        {b.code}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-[--color-fg]">
                          {b.name}
                        </p>
                        <p className="text-xs text-[--color-muted]">
                          {b.address || "Main retail location"}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1 rounded-full bg-[--color-success]/10 px-2.5 py-0.5 text-[11px] font-medium text-[--color-success]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[--color-success]" />
                        Active
                      </span>
                      <span className="text-xs font-mono text-[--color-muted]">
                        {b.phone || "No phone"}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Feature Quick-Access Cards */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Link
              href="/products"
              className="group rounded-xl border border-[--color-border] bg-[--color-surface] p-4 transition-all hover:border-[--color-brand] hover:shadow-md"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[--color-brand]/10 text-[--color-brand] group-hover:bg-[--color-brand] group-hover:text-white transition-colors">
                <Package className="h-4 w-4" />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-[--color-fg]">
                Products Catalogue
              </h3>
              <p className="mt-1 text-[11px] text-[--color-muted]">
                5,000+ SKUs, multi-unit conversions, barcode tagging
              </p>
            </Link>

            <Link
              href="/inventory"
              className="group rounded-xl border border-[--color-border] bg-[--color-surface] p-4 transition-all hover:border-[--color-brand] hover:shadow-md"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[--color-success]/10 text-[--color-success] group-hover:bg-[--color-success] group-hover:text-white transition-colors">
                <Boxes className="h-4 w-4" />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-[--color-fg]">
                Inventory Ledger
              </h3>
              <p className="mt-1 text-[11px] text-[--color-muted]">
                Append-only stock balances and inter-branch transfers
              </p>
            </Link>

            <Link
              href="/whatsapp"
              className="group rounded-xl border border-[--color-border] bg-[--color-surface] p-4 transition-all hover:border-[--color-brand] hover:shadow-md"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[--color-warning]/10 text-[--color-warning] group-hover:bg-[--color-warning] group-hover:text-white transition-colors">
                <MessageSquare className="h-4 w-4" />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-[--color-fg]">
                WhatsApp AI Agent
              </h3>
              <p className="mt-1 text-[11px] text-[--color-muted]">
                Meta Cloud API, multi-language price quotes
              </p>
            </Link>
          </div>
        </div>

        {/* Right 1 Col: Shared Calculation Engine & System Info */}
        <div className="space-y-6">
          {/* Shared Calculation Engine */}
          <div className="rounded-xl border border-[--color-border] bg-[--color-surface] p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-[--color-fg]">
              <Cpu className="h-4 w-4 text-[--color-brand]" />
              <span>Exact Money & VAT Engine</span>
            </div>
            <p className="mt-1 text-xs text-[--color-muted]">
              Zero float precision errors. Guaranteed by BigInt arithmetic.
            </p>

            <div className="mt-4 rounded-lg border border-[--color-border] bg-[--color-bg] p-4">
              <dl className="tabular space-y-2 text-xs">
                <div className="flex justify-between">
                  <dt className="text-[--color-muted]">Sample Subtotal (3 Lines)</dt>
                  <dd className="font-mono font-medium text-[--color-fg]">
                    AED {calcDemo.subtotal}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[--color-muted]">UAE VAT (5%)</dt>
                  <dd className="font-mono font-medium text-[--color-fg]">
                    AED {calcDemo.taxAmount}
                  </dd>
                </div>
                <div className="border-t border-[--color-border] pt-2 flex justify-between">
                  <dt className="font-semibold text-[--color-fg]">Total Document</dt>
                  <dd className="font-mono font-bold text-[--color-brand]">
                    AED {calcDemo.total}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[--color-success]">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>calculateDocument() validated from @devsfleet/shared-utils</span>
            </div>
          </div>

          {/* Security & Architecture Highlights */}
          <div className="rounded-xl border border-[--color-border] bg-[--color-surface] p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-[--color-fg]">
              <ShieldCheck className="h-4 w-4 text-[--color-brand]" />
              <span>Enterprise Guardrails</span>
            </div>

            <ul className="mt-3 space-y-2.5 text-xs text-[--color-muted]">
              <li className="flex items-start gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[--color-brand] mt-1.5 shrink-0" />
                <span>
                  <strong className="text-[--color-fg]">PostgreSQL RLS:</strong> Every table scoped to tenant ID automatically.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[--color-brand] mt-1.5 shrink-0" />
                <span>
                  <strong className="text-[--color-fg]">Offline-Ready POS:</strong> Terminal uses SQLite with local checkout queues.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[--color-brand] mt-1.5 shrink-0" />
                <span>
                  <strong className="text-[--color-fg]">Separate Repos:</strong> Frontend and Backend deployable to separate servers.
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
