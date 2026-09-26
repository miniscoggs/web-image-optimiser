import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000, // encoding and scoring share the cpu with the golden shards
  },
});
