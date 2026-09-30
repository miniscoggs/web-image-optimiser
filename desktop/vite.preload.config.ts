import { defineConfig } from "vite";

// the desktop app's preload, bundled into one commonjs file, since a sandboxed preload can only
// require electron's own modules

export default defineConfig({
  root: import.meta.dirname,
  logLevel: "warn",
  build: {
    lib: {
      entry: "src/preload/index.ts",
      formats: ["cjs"],
      fileName: () => "index.cjs",
    },
    outDir: "build/preload",
    emptyOutDir: true,
    minify: false,
    rolldownOptions: { external: ["electron"] },
  },
});
