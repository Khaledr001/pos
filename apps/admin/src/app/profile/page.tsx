"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BadgeCheck,
  Building2,
  CircleSlash,
  Eye,
  GitBranch,
  Loader2,
  LogOut,
  Mail,
  Moon,
  Percent,
  RefreshCw,
  ShieldCheck,
  Sun,
  Tag,
  UserRound,
  Wallet,
} from "lucide-react";
import { SUPERUSER_PERMISSION, type PermissionGrant } from "@devsfleet/shared-types";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Your own account.
 *
 * Deliberately built from `GET /auth/me` and the session, NOT from
 * `GET /users/:id` — that route requires `user:read`, which is permission to
 * browse the staff directory. A cashier looking at their own profile is not
 * reading the directory, and gating this page behind that permission would
 * mean the people most likely to ask "what am I allowed to do?" are the only
 * ones who cannot find out.
 *
 * Which is the other half of what this page is for. Half the support
 * questions in a POS are really authorisation questions — why a discount was
 * refused, why cost prices are hidden, why a branch is missing from a list.
 * Those answers live in ABAC attributes nothing in the UI previously showed.
 */

/** What `/auth/me` returns — the principal behind the current access token. */
interface Me {
  id: string;
  tenantId: string | null;
  branchId: string | null;
  roleId: string;
  roleName: string;
  permissions: PermissionGrant[];
  abac: {
    maxDiscountPercent: string;
    maxSaleAmount: string | null;
    canApproveRefund: boolean;
    canViewCost: boolean;
    allowedBranchIds: string[];
  };
  isPlatformAdmin: boolean;
  planId: string;
  trialEndsAt: string | null;
  impersonatedBy?: string;
}

export default function ProfilePage() {
  const { user, tokens, logout } = useAuth();
  const { theme, setTheme } = useTheme();

  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const fetchMe = useCallback(async () => {
    if (!tokens?.accessToken) return;
    setLoading(true);
    setError(null);
    try {
      setMe(await api.get<Me>("/auth/me", { accessToken: tokens.accessToken }));
    } catch (err: any) {
      setError(err?.message || "Could not load your account details.");
    } finally {
      setLoading(false);
    }
  }, [tokens]);

  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  const isSuperuser = me?.permissions.includes(SUPERUSER_PERMISSION) ?? false;

  /**
   * Grouped by the resource before the colon, so "what can I do with
   * products" is one glance rather than a scan of a flat 40-item list.
   */
  const permissionGroups = useMemo(() => {
    const grouped = new Map<string, string[]>();
    for (const grant of me?.permissions ?? []) {
      if (grant === SUPERUSER_PERMISSION) continue;
      const [resource = "other", action = grant] = grant.split(":");
      const bucket = grouped.get(resource);
      if (bucket) bucket.push(action);
      else grouped.set(resource, [action]);
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [me]);

  const initials = user?.name ? user.name.slice(0, 2).toUpperCase() : "AD";

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <UserRound className="size-5 text-primary" aria-hidden="true" />
            Profile
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Your account, your role, and exactly what it lets you do.
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={() => void fetchMe()} disabled={loading}>
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-3.5" aria-hidden="true" />
          )}
          Refresh
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Identity ─────────────────────────────────────────────────── */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar className="size-16 shrink-0 border-2 border-primary/20">
            <AvatarFallback className="bg-primary/10 text-lg font-bold text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold">{user?.name ?? "—"}</h2>
            {user?.email && (
              <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-muted-foreground">
                <Mail className="size-3.5 shrink-0" aria-hidden="true" />
                {user.email}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary">{user?.roleName ?? "—"}</Badge>
              {isSuperuser && <Badge variant="warning">Full access</Badge>}
              {me?.isPlatformAdmin && <Badge variant="destructive">Platform operator</Badge>}
            </div>
          </div>
        </div>

        {/* Impersonation is a security-relevant fact about the session, so it
            is stated on the account page and not only in the top banner. */}
        {me?.impersonatedBy && (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-600 dark:text-amber-400">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              A platform operator is currently signed in as you. Actions taken now are recorded
              against this account with their identity attached.
            </span>
          </p>
        )}
      </Card>

      {/* ── Where you work ───────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <SectionHeading>Where you work</SectionHeading>
        <dl className="divide-y divide-border">
          <DetailRow icon={Building2} label="Business" value={user?.tenantName ?? "—"} />
          <DetailRow
            icon={GitBranch}
            label="Branch"
            value={user?.branchName ?? "Not pinned to one branch"}
            hint={
              user?.branchName
                ? undefined
                : "Your session is not tied to a single branch, so actions that need one ask you to choose."
            }
          />
          <DetailRow icon={Tag} label="Role" value={user?.roleName ?? "—"} />
          <DetailRow
            icon={GitBranch}
            label="Branch access"
            value={
              !me
                ? "—"
                : me.abac.allowedBranchIds.length === 0
                  ? "Every branch"
                  : `${me.abac.allowedBranchIds.length} branch${
                      me.abac.allowedBranchIds.length === 1 ? "" : "es"
                    }`
            }
            hint={
              me?.abac.allowedBranchIds.length === 0
                ? "An empty branch list means all of them — that is how an owner is represented."
                : undefined
            }
          />
        </dl>
      </Card>

      {/* ── Limits ───────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <SectionHeading>What your role allows</SectionHeading>
        {loading && !me ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="grid gap-px bg-border sm:grid-cols-2">
            <LimitTile
              icon={Percent}
              label="Discount ceiling"
              value={me ? `${me.abac.maxDiscountPercent}%` : "—"}
              note="Above this, a manager has to approve the line."
            />
            <LimitTile
              icon={Wallet}
              label="Maximum sale"
              value={me?.abac.maxSaleAmount ? me.abac.maxSaleAmount : "No ceiling"}
              note="The largest single sale you can ring up."
            />
            <LimitTile
              icon={me?.abac.canApproveRefund ? BadgeCheck : CircleSlash}
              label="Approve refunds"
              value={me?.abac.canApproveRefund ? "Yes" : "No"}
              tone={me?.abac.canApproveRefund ? "on" : "off"}
            />
            <LimitTile
              icon={me?.abac.canViewCost ? Eye : CircleSlash}
              label="See cost prices"
              value={me?.abac.canViewCost ? "Yes" : "No"}
              tone={me?.abac.canViewCost ? "on" : "off"}
              note="Gates purchase price and margin everywhere."
            />
          </div>
        )}
      </Card>

      {/* ── Permissions ──────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <SectionHeading>
          Permissions
          {!isSuperuser && me && (
            <span className="ml-2 font-normal text-muted-foreground">
              {me.permissions.length}
            </span>
          )}
        </SectionHeading>

        {isSuperuser ? (
          <p className="px-4 py-5 text-sm text-muted-foreground">
            This role carries the <span className="font-mono text-xs">*</span> grant — every
            permission in the system, including ones added in future releases.
          </p>
        ) : permissionGroups.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {loading ? "Loading…" : "No permissions are assigned to this role."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {permissionGroups.map(([resource, actions]) => (
              <li key={resource} className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 px-4 py-2.5">
                <span className="w-28 shrink-0 text-xs font-semibold capitalize text-foreground">
                  {resource.replace(/_/g, " ")}
                </span>
                <div className="flex flex-1 flex-wrap gap-1">
                  {actions.sort().map((action) => (
                    <Badge key={action} variant="outline" className="font-mono text-[10px]">
                      {action}
                    </Badge>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ── Appearance ───────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <SectionHeading>Appearance</SectionHeading>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
          <div>
            <p className="text-sm font-medium">Theme</p>
            <p className="text-xs text-muted-foreground">
              Remembered on this device only.
            </p>
          </div>
          {/*
            A radio group, not a toggle: a two-state switch cannot show which
            of the two you are on without the user first knowing what the
            switch means. Two labelled buttons say it outright.
          */}
          <div
            role="radiogroup"
            aria-label="Theme"
            className="flex gap-1 rounded-lg border border-input p-1"
          >
            {(
              [
                ["light", "Light", Sun],
                ["dark", "Dark", Moon],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={theme === value}
                onClick={() => setTheme(value)}
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  theme === value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Icon className="size-3.5" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* ── Session ──────────────────────────────────────────────────── */}
      <Card className="overflow-hidden border-destructive/30">
        <SectionHeading>Session</SectionHeading>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
          <div>
            <p className="text-sm font-medium">Sign out</p>
            <p className="text-xs text-muted-foreground">
              Ends this session on this device.
            </p>
          </div>
          <Button variant="destructive" size="sm" onClick={() => setConfirmOpen(true)}>
            <LogOut className="size-3.5" aria-hidden="true" />
            Sign out
          </Button>
        </div>
      </Card>

      <p className="pb-2 text-center font-mono text-[10px] text-muted-foreground">
        {me?.id ?? user?.id}
      </p>

      {/* Same confirmation the sidebar uses — a destructive action gets one
          regardless of which control started it. */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-destructive/10">
              <LogOut className="size-5 text-destructive" aria-hidden="true" />
            </div>
            <DialogTitle className="text-center">Sign out?</DialogTitle>
            <DialogDescription className="text-center">
              You will be returned to the login screen. Any unsaved changes will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2 flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmOpen(false)}>
              Stay signed in
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={() => {
                setConfirmOpen(false);
                logout();
              }}
            >
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="border-b border-border bg-secondary/40 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof UserRound;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
      <dt className="flex w-40 shrink-0 items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        {label}
      </dt>
      <dd className="min-w-0 flex-1">
        <span className="text-sm font-medium">{value}</span>
        {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
      </dd>
    </div>
  );
}

function LimitTile({
  icon: Icon,
  label,
  value,
  note,
  tone,
}: {
  icon: typeof UserRound;
  label: string;
  value: string;
  note?: string;
  tone?: "on" | "off";
}) {
  return (
    <div className="bg-card px-4 py-3.5">
      <div className="flex items-center gap-2">
        {/*
          The icon repeats what the value already says, so it is decorative and
          hidden from the accessibility tree — a screen reader gets "Approve
          refunds, Yes", not a stray "check" in between.
        */}
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            tone === "on"
              ? "text-emerald-600 dark:text-emerald-400"
              : tone === "off"
                ? "text-muted-foreground"
                : "text-primary",
          )}
          aria-hidden="true"
        />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p
        className={cn(
          "mt-1 font-mono text-base font-semibold",
          tone === "off" && "text-muted-foreground",
        )}
      >
        {value}
      </p>
      {note && <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{note}</p>}
    </div>
  );
}
