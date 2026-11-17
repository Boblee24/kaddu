import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**"],
    environment: "node",
    env: { AI_MOCK: "1" },
    // PGlite (in-memory Postgres, WASM) can take >10 s to boot when several test files start at once.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
