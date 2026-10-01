import { NextResponse, type NextRequest } from "next/server";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:4000";

const SESSIONS = [
  { access: "al_at", refresh: "al_rt", path: "/api/v1/auth/refresh" },
  { access: "al_sat", refresh: "al_srt", path: "/api/v1/auth/staff/refresh" },
];

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
export async function proxy(request: NextRequest) {
  const setCookies: string[] = [];
  const cookieHeader = new Map(request.cookies.getAll().map((c) => [c.name, c.value]));

  for (const s of SESSIONS) {
    const refresh = request.cookies.get(s.refresh)?.value;
    if (!refresh || !expiresSoon(request.cookies.get(s.access)?.value)) continue;
    try {
      const res = await fetch(`${API_ORIGIN}${s.path}`, {
        method: "POST",
        headers: { cookie: `${s.refresh}=${refresh}` },
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
  // Pages only: not the API rewrite, static files or images.
  matcher: ["/((?!api/|_next/|uploads/|favicon.ico|robots.txt|sitemap.xml).*)"],
};
