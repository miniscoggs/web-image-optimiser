import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// npm run dev:ui serves the ui with hot reload, passing the api to a `wio ui --port 5174`
// started first, whose session cookie the browser also sends to this port

export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ["react", "react-dom"] },
  build: {
    outDir: "../dist/ui",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1", // the cookie's host, which localhost wouldn't match
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5174",
        headers: { origin: "http://127.0.0.1:5174" }, // the server refuses requests from another origin, this port included
      },
    },
  },
});
