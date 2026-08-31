import type { NextConfig } from "next";
import path from "node:path";

const config: NextConfig = {
  reactStrictMode: true,

  /**
   * Workspace packages ship TypeScript sources, not built JS, so Next has to
   * compile them itself. Without this they arrive as untranspiled ESM and the
   * build fails on the first `import type`.
   */
  transpilePackages: ["@devsfleet/shared-types", "@devsfleet/shared-utils"],

  experimental: {
    // The monorepo root, so Next traces files for the standalone output
    // correctly rather than assuming apps/admin is the project root.
    externalDir: true,
  },

  images: {
    // Product images are served from MinIO.
    remotePatterns: [
      { protocol: "http", hostname: "localhost", port: "9000" },
      { protocol: "https", hostname: "**.devsfleet.com" },
    ],
  },

  /**
   * Security headers, including a CSP.
   *
   * The panel had none. That matters more here than on most dashboards: the
   * session tokens live in localStorage, so any script that runs on this origin
   * can read a refresh token and keep the session going from anywhere. A CSP
   * does not make localStorage safe, but it is what stands between an injected
   * string and it becoming executable.
   *
   * `unsafe-inline` for styles is Next's requirement — it inlines critical CSS.
   * `unsafe-eval` is NOT granted; the dev server needs it, so the policy is
   * relaxed only when NODE_ENV is development.
   */
  async headers() {
    const dev = process.env.NODE_ENV === "development";
    const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
    const apiOrigin = new URL(api).origin;
    /**
     * The notification gateway's origin, stated explicitly.
     *
     * socket.io opens `wss://api.../socket.io/`, and browsers have not agreed
     * on whether an `https:` source in connect-src also covers `wss:` to the
     * same host. Listing it costs one token and removes the question; leaving
     * it to be inferred risks a panel where notifications silently never
     * arrive in production and work perfectly in development, because `ws:`
     * is only added to the dev policy below.
     */
    const wsOrigin = apiOrigin.replace(/^http/, "ws");
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""} https://static.cloudflareinsights.com`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: http://localhost:9000 https://*.devsfleet.com",
      `connect-src 'self' ${apiOrigin} ${wsOrigin}${dev ? " ws: http://localhost:*" : ""} https://cloudflareinsights.com`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },

  // Emits a self-contained server bundle — the deployment target is a
  // self-hosted VPS, not a platform that installs dependencies for you.
  output: "standalone",

  /**
   * Trace from the workspace root, not from apps/admin.
   *
   * Left unset, Next infers the root from the nearest lockfile and silently
   * guesses wrong in a monorepo, emitting a bundle whose dependency paths do
   * not resolve. `experimental.externalDir` above does NOT do this — it only
   * permits imports from outside the app directory.
   */
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),

  /**
   * Force @swc/helpers in whole. The tracer alone ships 3 of its 438 files.
   *
   * It copies `cjs/` and package.json, then stops, because the only thing that
   * reaches the ESM half is `next/dist/server/require-hook.js` resolving it
   * dynamically at runtime — a static trace cannot see that. The bundle builds
   * and looks complete, and then the server dies on its first boot with
   * `Cannot find module '@swc/helpers/esm/_interop_require_default.js'`.
   *
   * Keyed by "/**" so it applies to every route rather than one entry point.
   * Verify after changing anything here by actually STARTING the standalone
   * output — a successful `next build` says nothing about whether it runs.
   */
  outputFileTracingIncludes: {
    "/**": ["../../node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers/**"],
  },
};

export default config;
