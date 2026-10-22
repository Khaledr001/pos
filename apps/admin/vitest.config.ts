import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The same `@/` alias as tsconfig, so a test can import a module that uses it.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
