"use client";

import React from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/** Success / error banners, the same as every other admin screen. */
export function Notice({ kind, message, onClose }: { kind: "success" | "error"; message: string; onClose: () => void }) {
  const tone =
    kind === "success"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : "border-destructive/30 bg-destructive/10 text-destructive";
  const Icon = kind === "success" ? CheckCircle2 : AlertCircle;
  return (
    <div className={`flex items-center justify-between rounded-xl border p-3 text-xs ${tone}`}>
      <div className="flex items-center gap-2"><Icon className="h-4 w-4 shrink-0" /><span>{message}</span></div>
      <button onClick={onClose} className="cursor-pointer" aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>
    </div>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <div className="py-16 text-center text-sm text-muted-foreground">
      <div className="h-6 w-6 mx-auto mb-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      {label}
    </div>
  );
}

export function PageHeader({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2 sm:gap-3">{children}</div>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-foreground mb-1.5">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export const selectClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20";
export const textareaClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20";

const LABELS: Record<string, string> = {
  COD: "Cash on delivery",
  CARD: "Card",
  APPLE_PAY: "Apple Pay",
  GOOGLE_PAY: "Google Pay",
  ABU_DHABI: "Abu Dhabi",
  DUBAI: "Dubai",
  SHARJAH: "Sharjah",
  AJMAN: "Ajman",
  UMM_AL_QUWAIN: "Umm Al Quwain",
  RAS_AL_KHAIMAH: "Ras Al Khaimah",
  FUJAIRAH: "Fujairah",
};

/** "PENDING_PAYMENT" -> "Pending payment"; proper names keep their capitals. */
export function humanize(value: string): string {
  const known = LABELS[value];
  if (known) return known;
  const words = value.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const STATUS_TONE: Record<string, "success" | "warning" | "secondary" | "destructive" | "default"> = {
  PENDING_PAYMENT: "warning",
  PLACED: "default",
  CONFIRMED: "default",
  PACKED: "default",
  SHIPPED: "default",
  READY_FOR_PICKUP: "warning",
  DELIVERED: "success",
  COLLECTED: "success",
  CANCELLED: "secondary",
  REFUNDED: "secondary",
  PAID: "success",
  PENDING: "warning",
  FAILED: "destructive",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_TONE[status] ?? "secondary"}>{humanize(status)}</Badge>;
}

/** Display only. Amounts arrive as decimal strings and are never added up here. */
export function money(amount: string | number | null | undefined, currency = "AED"): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const [whole = "0", fraction = ""] = String(amount).split(".");
  // Grouped as text: money never becomes a float, even for display.
  return `${currency} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(fraction + "00").slice(0, 2)}`;
}

export function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
