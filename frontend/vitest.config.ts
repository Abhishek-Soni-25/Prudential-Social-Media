import { defineConfig } from "vitest/config";

// The compliance engine and its tests live in ../lib/compliance (repo-root `lib/`,
// per the deliverable paths). Vitest runs from the frontend package but reaches up.
export default defineConfig({
  test: {
    environment: "node",
    include: ["../lib/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
    globals: false,
  },
});
