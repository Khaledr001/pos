import path from "node:path";
import type { NextConfig } from "next";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  transpilePackages: ["@devsfleet/storefront-client"],
  poweredByHeader: false,
  // Self-contained server for the Docker image; trace files from the monorepo root.
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  images: {
    // Product images uploaded through the admin are served by the API at /uploads.
    localPatterns: [{ pathname: "/uploads/**" }],
    // Product photos are the POS's own, served from its object storage.
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "localhost" },
      { protocol: "http", hostname: "127.0.0.1" },
    ],
  },
  // The browser only ever talks to this origin; the platform API sits behind
  // it, so its httpOnly cookies are first-party and there is no CORS. The
  // proxy forwards this site's host as x-forwarded-host, which is how the API
  // knows which tenant's shop this is.
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${API_ORIGIN}/api/v1/storefront/:path*` }];
  },
};

export default nextConfig;
