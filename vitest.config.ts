import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    testTimeout: 60_000
  }
});
