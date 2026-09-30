import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    testTimeout: 120_000, // encoding and scoring share the cpu with the other files and the golden shards, and ci's intel mac is the slowest
    projects: [
      {
        extends: true,
        test: { name: "node", include: ["tests/**/*.test.ts"] },
      },
      {
        extends: true,
        test: {
          name: "dom", // the ui's components, rendered with react testing library
          include: ["tests/ui/**/*.test.tsx"],
          environment: "happy-dom",
          setupFiles: ["tests/ui/setup.ts"],
        },
      },
    ],
  },
});
