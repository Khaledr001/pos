"use client";

import { redirect, usePathname } from "next/navigation";

/** Sends a visitor without a staff session to the login page, then back here. */
export function LoginRedirect(): null {
  const pathname = usePathname();
  const next = pathname && pathname !== "/admin" ? `?next=${encodeURIComponent(pathname)}` : "";
  return redirect(`/admin/login${next}`);
}
