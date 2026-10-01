import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests against a running stack: the platform API with a tenant's
 * storefront seeded (`pnpm db:seed:storefront -- --tenant devsfleet --domain localhost`)
 * and STOREFRONT_DEV_PAYMENTS=true, and this app on :3002. Uses the system Chrome.
 *   pnpm --filter @devsfleet/storefront test:e2e
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3002",
    channel: "chrome",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "mobile", use: { ...devices["Pixel 7"], channel: "chrome" }, testMatch: /smoke/ },
  ],
});
