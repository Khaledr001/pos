   import { defineConfig } from "vitest/config";

/**
 * A separate config for `electron/**` tests, deliberately NOT the app's own
 * `vite.config.ts`.
 *
 * That config carries `vite-plugin-electron-renderer`, which aliases Node
 * built-ins (`node:path`, `electron` itself) to browser shims for the
 * RENDERER bundle. Vitest inherits plugins from `vite.config.ts` by default,
 * so a test that imports main-process code — plain Node, real `electron`
 * module — got those aliases applied to it too, and `node:path` resolved to a
 * renderer polyfill that doesn't have `require`.
 *
 * Run through `pnpm test:electron`, which also has to invoke Electron's own
 * binary as its Node runtime: `better-sqlite3` is a native module compiled
 * for whichever ABI last ran `pnpm install`, which this repo's `postinstall`
 * always leaves as Electron's, not plain Node's.
 */
export default defineConfig({
  test: {
    include: ["electron/**/*.{test,spec}.ts"],
    environment: "node",
  },
});
