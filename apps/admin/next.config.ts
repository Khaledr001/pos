import type { NextConfig } from "next";

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
    const csp = [
      "default-src 'self'",
      `script-src 'self'${dev ? " 'unsafe-eval' 'unsafe-inline'" : ""}`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: http://localhost:9000 https://*.devsfleet.com",
      `connect-src 'self' ${new URL(api).origin}${dev ? " ws: http://localhost:*" : ""}`,
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
};

export default config;
