import type { CookieOptions, Request, Response } from "express";

/**
 * Shopper session cookies.
 *
 * The storefront proxies `/api/v1/*` to this API from its own origin, so these
 * are first-party, httpOnly cookies on the shop's domain — the browser never
 * holds a token script can read. `SameSite=Lax` keeps them off cross-site
 * POSTs, and every storefront write takes a JSON body, which a form on another
 * site cannot send without a CORS preflight this API does not grant.
 */
export const SHOPPER_ACCESS_COOKIE = "sf_at";
export const SHOPPER_REFRESH_COOKIE = "sf_rt";
/** A guest's cart. Not a credential: it only ever names a cart. */
export const CART_COOKIE = "sf_cart";

/** No cookie-parser in this app — the storefront is the only cookie reader. */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return undefined;
}

export function cookieOptions(secure: boolean, maxAgeMs?: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
  };
}

export function clearCookie(res: Response, name: string, secure: boolean): void {
  res.clearCookie(name, cookieOptions(secure));
}

/**
 * The shop's own hostname, which is what resolves the tenant.
 *
 * `x-storefront-host` is sent by the storefront's server when it calls this
 * API directly (its own Host header then names the API). A browser request
 * comes through the storefront's rewrite proxy, which forwards the original
 * host as `x-forwarded-host`. Either can be spoofed by a caller — which buys
 * them another tenant's PUBLIC catalogue and nothing else: shopper tokens are
 * bound to their tenant and checked against the resolved one.
 */
export function storefrontHost(req: Request): string | undefined {
  const pick = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  return (
    pick(req.headers["x-storefront-host"]) ??
    pick(req.headers["x-forwarded-host"]) ??
    pick(req.headers.host)
  );
}
