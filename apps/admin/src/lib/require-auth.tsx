"use client";

import type { Permission } from "@devsfleet/shared-types";
import { hasPermission } from "@devsfleet/shared-types";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "./auth-context";

/**
 * The admin panel's route guard.
 *
 * There was none. Every page under `/` rendered its shell, its navigation and
 * its empty tables to anybody who typed the URL — the API refused the data, so
 * nothing leaked, but the app was indistinguishable from a signed-in one until
 * the requests came back, and the sign-in state it did keep was never checked
 * anywhere.
 *
 * This is a convenience and a correctness fix, NOT the security boundary. The
 * boundary is the API: `JwtAuthGuard` and `PermissionsGuard` decide what a
 * token may do, and no amount of client-side routing changes that. What this
 * buys is an interface that tells the truth about what the person in front of
 * it can actually do.
 */
export function RequireAuth({
  children,
  permission,
  platformOnly,
}: {
  children: ReactNode;
  /** Also require this permission. Omit for "any signed-in user". */
  permission?: Permission;
  /** Require platform super admin privileges. */
  platformOnly?: boolean;
}) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // `isLoading` covers the first paint, while the session is still being read
    // out of storage. Redirecting during it would bounce every reload to login.
    if (isLoading || user) return;
    router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [isLoading, user, router, pathname]);

  if (isLoading) return <PageMessage title="Loading…" />;
  if (!user) return <PageMessage title="Redirecting to sign in…" />;

  if (platformOnly && !user.isPlatformAdmin) {
    return (
      <PageMessage
        title="Platform Super Admin Access Required"
        detail="This section is restricted to DevsFleet platform operators."
      />
    );
  }

  if (permission && !hasPermission(user.permissions as Permission[], permission)) {
    return (
      <PageMessage
        title="You do not have access to this"
        detail={`This page needs the "${permission}" permission. Ask an administrator if you need it.`}
      />
    );
  }

  return <>{children}</>;
}

/**
 * Show a control only to someone who could actually use it.
 *
 * A button that always 403s is worse than an absent one: it reads as a bug,
 * and the person clicking it has no way to tell the difference.
 */
export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { user } = useAuth();
  if (!user) return <>{fallback}</>;
  return hasPermission(user.permissions as Permission[], permission) ? (
    <>{children}</>
  ) : (
    <>{fallback}</>
  );
}

/** Non-reactive read, for handlers and conditional props. */
export function usePermission(permission: Permission): boolean {
  const { user } = useAuth();
  return hasPermission((user?.permissions ?? []) as Permission[], permission);
}

function PageMessage({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-center">
      <p className="text-lg font-semibold text-foreground">{title}</p>
      {detail && <p className="max-w-md text-sm text-muted-foreground">{detail}</p>}
    </div>
  );
}
