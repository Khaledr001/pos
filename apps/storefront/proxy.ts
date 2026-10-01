import { NextResponse, type NextRequest } from "next/server";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:3001";
/** Pinned for a single-shop deployment; otherwise the visitor's own host names the tenant. */
const STOREFRONT_HOST = process.env.STOREFRONT_HOST;

const SESSIONS = [{ access: "sf_at", refresh: "sf_rt", path: "/api/v1/storefront/auth/refresh" }];

/** True when the JWT is missing or expires within 30 s. Signature is checked by the API, not here. */
function expiresSoon(token: string | undefined) {
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp !== "number" || payload.exp * 1000 < Date.now() + 30_000;
  } catch {
    return true;
  }
}

/**
 * Renews an expired access token on page loads, so server-rendered pages see
 * the visitor as logged in. Only an optimistic convenience: every API route
 * still checks the token itself.
 */
/**
 * The browser's /api/v1 calls are proxied to the platform API by this
 * server, so the API sees this server's IP for every shopper. Name the
 * shopper and prove it is us, or the API rate-limits the whole shop as one
 * client. See StorefrontAwareThrottlerGuard in the API.
 */
function forApi(request: NextRequest) {
  const secret = process.env.STOREFRONT_PROXY_SECRET;
  const clientIp = (request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "").split(",")[0]!.trim();
  if (!secret || !clientIp) return NextResponse.next();
  const headers = new Headers(request.headers);
  headers.set("x-storefront-proxy", secret);
  headers.set("x-storefront-client-ip", clientIp);
  return NextResponse.next({ request: { headers } });
}

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/v1/")) return forApi(request);

  const setCookies: string[] = [];
  const cookieHeader = new Map(request.cookies.getAll().map((c) => [c.name, c.value]));

  for (const s of SESSIONS) {
    const refresh = request.cookies.get(s.refresh)?.value;
    if (!refresh || !expiresSoon(request.cookies.get(s.access)?.value)) continue;
    try {
      const res = await fetch(`${API_ORIGIN}${s.path}`, {
        method: "POST",
        headers: {
          cookie: `${s.refresh}=${refresh}`,
          "x-storefront-host": STOREFRONT_HOST ?? request.headers.get("host") ?? "localhost",
        },
        signal: AbortSignal.timeout(5000),
      });
      const fresh = res.headers.getSetCookie();
      setCookies.push(...fresh);
      for (const c of fresh) {
        const [pair] = c.split(";");
        const eq = pair.indexOf("=");
        const name = pair.slice(0, eq);
        const value = pair.slice(eq + 1);
        if (value) cookieHeader.set(name, value);
        else cookieHeader.delete(name);
      }
    } catch {
      // API unreachable: carry on; the page renders as logged out.
    }
  }

  if (!setCookies.length) return NextResponse.next();

  const headers = new Headers(request.headers);
  headers.set("cookie", [...cookieHeader].map(([k, v]) => `${k}=${v}`).join("; "));
  const response = NextResponse.next({ request: { headers } });
  for (const c of setCookies) response.headers.append("set-cookie", c);
  return response;
}

export const config = {
  // Pages, plus the API rewrite (for the proxy headers above). Not the
  // revalidate route, static files or images.
  matcher: ["/api/v1/:path*", "/((?!api/|_next/|uploads/|favicon.ico|robots.txt|sitemap.xml).*)"],
};
