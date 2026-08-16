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

  // Emits a self-contained server bundle — the deployment target is a
  // self-hosted VPS, not a platform that installs dependencies for you.
  output: "standalone",
};

export default config;
