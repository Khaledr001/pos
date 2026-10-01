import path from "node:path";
import type { NextConfig } from "next";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  transpilePackages: ["@al-lahiq/api-client"],
  poweredByHeader: false,
  // Self-contained server for the Docker image; trace files from the monorepo root.
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, ".."),
  images: {
    // Product images uploaded through the admin are served by the API at /uploads.
    localPatterns: [{ pathname: "/uploads/**" }],
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  // The browser only ever talks to this origin; the API sits behind it, so
  // its httpOnly cookies are first-party and there is no CORS.
  async rewrites() {
    return [
      { source: "/api/v1/:path*", destination: `${API_ORIGIN}/api/v1/:path*` },
      { source: "/uploads/:path*", destination: `${API_ORIGIN}/uploads/:path*` },
    ];
  },
};

export default nextConfig;
