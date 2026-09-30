import { defineConfig } from "vite";

// the desktop app's main process, bundled into one es module. it takes the engine from the
// root's build through #app at run time, so only its own modules are bundled

export default defineConfig({
  root: import.meta.dirname,
  logLevel: "warn",
  build: {
    ssr: "src/main/index.ts",
    outDir: "build/main",
    emptyOutDir: true,
    target: "node24",
    rolldownOptions: { external: ["electron", "#app"] },
  },
});
