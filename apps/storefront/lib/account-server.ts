import "server-only";
import { ApiError } from "@devsfleet/storefront-client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { visitorApi } from "./api-server";

/**
 * Optimistic session check: is there an unexpired customer access token?
 * (proxy.ts has already renewed an expired one on this page load.) The
 * signature is checked by the API on every data call, so this only decides
 * whether to send the visitor to /login early.
 *
 * Server components deliberately don't call /auth/me: the API rate-limits
 * /auth/* per IP, and every server-side call comes from this server's IP.
 * Customer details come from the browser's useMe() query instead.
 */
export async function hasSession() {
  const token = (await cookies()).get("sf_at")?.value;
  if (!token) return false;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" && payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

export function loginHref(path: string) {
  return `/login?next=${encodeURIComponent(path)}`;
}

/**
 * Account pages call this with their own path, so after logging in the
 * customer lands back on the exact page (e.g. an order linked from an email).
 */
export async function requireSession(path: string) {
  if (!(await hasSession())) redirect(loginHref(path));
}

/** GET account data for a server-rendered page; a rejected session goes to /login. */
export async function accountGet<T>(apiPath: string, pagePath: string): Promise<T> {
  try {
    return await (await visitorApi()).get<T>(apiPath);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect(loginHref(pagePath));
    throw err;
  }
}
