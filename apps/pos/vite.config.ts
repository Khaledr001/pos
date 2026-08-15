import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
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
 */
export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              external: ["electron", "better-sqlite3", "node-thermal-printer"],
            },
          },
        },
      },
      preload: {
        input: "electron/preload.ts",
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: { external: ["electron"] },
          },
        },
      },
      // Lets the renderer import Node built-ins that vite-plugin-electron
      // shims. Kept minimal on purpose.
      renderer: {},
    }),
    renderer(),
  ],
  build: {
    outDir: "dist",
    // The terminal is a fixed, known machine — no need to support old browsers,
    // and Chromium here is whatever Electron ships.
    target: "chrome128",
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
