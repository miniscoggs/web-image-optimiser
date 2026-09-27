import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// npm run dev serves the ui with hot reload, passing the api to a `wio ui --port 5174` it starts
// alongside, whose session cookie the browser also sends to this port

const API_ORIGIN = "http://127.0.0.1:5174";

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
      "^/\\?token=": API_ORIGIN, // the sign-in address, whose reply sets the cookie here and moves on to /
      "/api": {
        target: API_ORIGIN,
        headers: { origin: API_ORIGIN }, // the server refuses requests from another origin, this port included
      },
    },
  },
});
