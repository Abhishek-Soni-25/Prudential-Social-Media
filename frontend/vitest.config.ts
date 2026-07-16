import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

// The compliance engine and its tests live under src/compliance.
export default defineConfig({
  resolve: {
    alias: {
      "@compliance": fileURLToPath(new URL("./src/compliance", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    globals: false,
  },
});
