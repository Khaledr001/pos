import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

/**
 * NestJS + Vitest.
 *
 * The SWC plugin is required, not optional: Vitest transforms with esbuild,
 * which does not emit `design:paramtypes` metadata, and without that metadata
 * every constructor injection in the app resolves to `undefined`. SWC with
 * `decoratorMetadata: true` emits it the same way tsc does.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts"],
    root: "./",
  },
  plugins: [
    swc.vite({
      module: { type: "es6" },
      jsc: {
        target: "es2023",
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
