import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import electron from "vite-plugin-electron/simple";
import renderer from "vite-plugin-electron-renderer";

/**
 * One Vite build produces three outputs:
 *
 *   dist-electron/main.js      main process   (Node, CJS)
 *   dist-electron/preload.js   preload bridge (Node, CJS)
 *   dist/                      renderer       (browser, ESM)
 *
 * `better-sqlite3` is externalised: it is a native .node binding that cannot be
 * bundled, and it must stay in the main process regardless — the renderer has
 * no filesystem access by design.
 *
 * `pdfkit` is externalised too, for a subtler reason: at runtime it loads its
 * standard fonts (Helvetica, etc.) from a `data/*.afm` folder next to its own
 * module file. Bundled into one main.js, that folder no longer exists next to
 * anything, and `new PDFDocument()` throws ENOENT the first time an A4 invoice
 * is rendered. Left as a real `require("pdfkit")`, Node resolves it inside
 * node_modules where its own `data/` folder is still sitting beside it.
 */

/**
 * Renderer-only mode: `pnpm dev:ui`.
 *
 * Skips building the main process and skips launching Electron, so the UI runs
 * as a plain page at http://localhost:5173. Useful for working on screens and
 * layout, and required anywhere Electron cannot open a window — a machine with
 * no display, a container, CI.
 *
 * The app already copes with this: `posData` falls back to its in-memory
 * adapter when `window.devsfleet` is absent, so the whole sale flow still
 * works. Hardware and sync are the only things that need the real thing.
 */
const rendererOnly = process.env.POS_RENDERER_ONLY === "1";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    ...(rendererOnly ? [] : [electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          build: {
            outDir: "dist-electron",
            // Committed to the repo unminified and deliberately so: the
            // built main process is small enough that review reads the
            // actual diff, not a compressed one-liner nobody can check.
            minify: false,
            rollupOptions: {
              external: ["electron", "better-sqlite3", "node-thermal-printer", "pdfkit"],
            },
          },
        },
      },
      preload: {
        input: "electron/preload.ts",
        vite: {
          build: {
            outDir: "dist-electron",
            minify: false,
            rollupOptions: { external: ["electron"] },
          },
        },
      },
      // Lets the renderer import Node built-ins that vite-plugin-electron
      // shims. Kept minimal on purpose.
      renderer: {},
    }),
    renderer(),
  ]),
  ],
  build: {
    outDir: "dist",
    // The terminal is a fixed, known machine — no need to support old browsers,
    // and Chromium here is whatever Electron ships.
    target: "chrome128",
    sourcemap: true,
  },
  test: {
    /**
     * `electron/**` is excluded here on purpose — see `vitest.electron.config.ts`.
     *
     * Those tests import main-process code (`electron`, `better-sqlite3`), and
     * this config carries `vite-plugin-electron-renderer`, which aliases Node
     * built-ins to browser shims meant for the RENDERER bundle. Running them
     * under this config resolves `node:path` to that shim instead of the real
     * module. `better-sqlite3` is also compiled for Electron's ABI, which a
     * plain Node vitest run cannot load at all — see `pnpm test:electron`.
     */
    exclude: ["**/node_modules/**", "electron/**"],
  },
  server: {
    port: 5173,
    strictPort: true,

    /**
     * Poll for file changes instead of relying on inotify.
     *
     * This repo lives on a fuseblk (NTFS-3G) mount, and FUSE does not deliver
     * inotify events. Without polling, Vite never learns that a source file
     * changed: it keeps serving the module graph it built at startup, so you
     * edit a component, save, reload, and still see the previous version. The
     * failure is silent — no error, just stale output — which makes it cost far
     * more time than it should.
     *
     * 300ms is a compromise: fast enough to feel like normal HMR, slow enough
     * that polling a few thousand files does not spin a core.
     */
    watch: {
      usePolling: true,
      interval: 300,
      ignored: ["**/node_modules/**", "**/dist/**", "**/dist-electron/**", "**/.turbo/**"],
    },
  },
});
