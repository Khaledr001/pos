import type { OrderStatus, PaymentStatus } from "@al-lahiq/api-client";
import { ChevronLeft, CircleAlert, Info, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/lib/format";
import { ApiError, errorMessage } from "@/lib/api-browser";
import { ORDER_STATUS_TONE, PAYMENT_STATUS_TONE } from "./helpers";

export function PageHeader({
  title,
  description,
  actions,
  back,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  meta?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link
            href={back.href}
            className="mb-1 inline-flex items-center gap-1 text-sm font-medium text-steel hover:text-ink print:hidden"
          >
            <ChevronLeft className="size-4" aria-hidden />
            {back.label}
          </Link>
        )}
        <h1 className="text-[28px] sm:text-[32px] break-words">{title}</h1>
        {meta && <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-steel">{meta}</div>}
        {description && <p className="mt-1 max-w-3xl text-[15px] text-steel">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  flush,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** No body padding (for tables that run edge to edge). */
  flush?: boolean;
  id?: string;
}) {
  return (
    <section id={id} className={cn("min-w-0 rounded-[var(--radius-panel)] border border-galv bg-paper", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-galv px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-xl">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-steel">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(!flush && "p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Table wrapper: scrolls sideways inside its panel on small screens. */
export function DataTable({ children, className, minWidth = 640 }: { children: ReactNode; className?: string; minWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table
        style={{ minWidth }}
        className={cn(
          "w-full border-collapse text-[14px]",
          "[&_thead_th]:border-b [&_thead_th]:border-galv [&_thead_th]:bg-sheet [&_thead_th]:px-3 [&_thead_th]:py-2 [&_thead_th]:text-left [&_thead_th]:text-[13px] [&_thead_th]:font-semibold [&_thead_th]:text-steel [&_thead_th]:whitespace-nowrap",
          "[&_tbody_td]:border-b [&_tbody_td]:border-galv [&_tbody_td]:px-3 [&_tbody_td]:py-2.5 [&_tbody_td]:align-top",
          "[&_tbody_th]:border-b [&_tbody_th]:border-galv [&_tbody_th]:px-3 [&_tbody_th]:py-2.5 [&_tbody_th]:text-left [&_tbody_th]:font-normal [&_tbody_th]:align-top",
          "[&_tbody_tr:last-child>*]:border-b-0 [&_tbody_tr:hover]:bg-sheet/50",
          "[&_tfoot_td]:px-3 [&_tfoot_td]:py-1.5 [&_tfoot_th]:px-3 [&_tfoot_th]:py-1.5",
          className,
        )}
      >
        {children}
      </table>
    </div>
  );
}

/** Class for right-aligned numeric cells (money, quantities). */
export const num = "text-right font-cond text-[15px] font-semibold tabular-nums whitespace-nowrap";

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={ORDER_STATUS_TONE[status]}>{ORDER_STATUS[status]}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge tone={PAYMENT_STATUS_TONE[status]}>{PAYMENT_STATUS[status]}</Badge>;
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 px-4 py-10 justify-center text-steel">
      <span className="size-4 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden />
      {label}…
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const expired = error instanceof ApiError && error.status === 401;
  const forbidden = error instanceof ApiError && error.status === 403;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[var(--radius-panel)] border border-signal/30 bg-signal-tint px-4 py-3 text-signal">
      <CircleAlert className="size-5 shrink-0" aria-hidden />
      <p className="flex-1 min-w-48">
        {expired
          ? "Your session has ended. Log in again to carry on."
          : forbidden
            ? "Your staff role can't open this. Ask the store owner if you need access."
            : errorMessage(error)}
      </p>
      {expired ? (
        <Link href="/admin/login" className="font-semibold underline underline-offset-2">
          Log in again
        </Link>
      ) : onRetry && !forbidden && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const styles = {
    info: "border-galv bg-sheet text-ink",
    warning: "border-brass/40 bg-brass-tint text-ink",
    danger: "border-signal/30 bg-signal-tint text-ink",
    success: "border-pipe/30 bg-pipe-tint text-ink",
  }[tone];
  const Icon = tone === "info" || tone === "success" ? Info : TriangleAlert;
  const iconColor = { info: "text-steel", warning: "text-[#7a5a0c]", danger: "text-signal", success: "text-pipe" }[tone];
  return (
    <div className={cn("flex gap-2.5 rounded-[var(--radius-tag)] border px-3 py-2.5 text-sm", styles, className)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", iconColor)} aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && "mt-0.5", "text-ink/85")}>{children}</div>}
      </div>
    </div>
  );
}

/** Definition list for read-only facts. */
export function Facts({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1.5 text-sm", className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-steel">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Tabs that filter a list (not ARIA tabs: each one changes what is shown below). */
export function FilterTabs<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="-mb-px flex gap-1 overflow-x-auto border-b border-galv">
      {items.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(t.value)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap",
              active ? "border-pipe text-ink" : "border-transparent text-steel hover:text-ink",
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span
                className={cn(
                  "rounded-full px-1.5 font-cond text-[13px] font-semibold tabular-nums",
                  active ? "bg-pipe-tint text-pipe-dark" : "bg-galv text-steel",
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: ReactNode; href?: string }) {
  const body = (
    <>
      <p className="text-sm text-steel">{label}</p>
      <p className="mt-1 font-cond text-[30px] font-bold leading-none tabular-nums">{value}</p>
      {hint && <p className="mt-1.5 text-sm text-steel">{hint}</p>}
    </>
  );
  const cls = "block rounded-[var(--radius-panel)] border border-galv bg-paper p-4";
  return href ? (
    <Link href={href} className={cn(cls, "hover:border-steel-light")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Thumb({ url, alt, size = 40 }: { url: string | null | undefined; alt: string; size?: number }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className="shrink-0 rounded-[var(--radius-tag)] border border-galv bg-paper object-contain"
    />
  ) : (
    <div
      aria-hidden
      style={{ width: size, height: size }}
      className="shrink-0 rounded-[var(--radius-tag)] border border-dashed border-galv bg-[repeating-linear-gradient(135deg,var(--color-sheet)_0_6px,#eef1f3_6px_12px)]"
    />
  );
}

export function FormActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2 pt-2", className)}>{children}</div>;
}

/** Small "Saved" confirmation shown next to a save button. */
export function SavedHint({ show }: { show: boolean }) {
  return (
    <span role="status" className={cn("text-sm text-pipe transition-opacity", show ? "opacity-100" : "opacity-0")}>
      {show ? "Saved" : ""}
    </span>
  );
}
