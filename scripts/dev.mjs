// Serves the UI with hot reload on 127.0.0.1:5173 and its API from a wio ui server on 5174, in
// one process, then opens the page signed in. The API runs from dist, so run `npm run build`
// first, and again after changing src/. Usage: npm run dev [-- <folder>], serving fixtures/
// by default.
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "vite";
import { startUiServer } from "../dist/index.js";
import { forwardingPage } from "../dist/server/http.js";

const API_PORT = 5174; // the port ui/vite.config.ts proxies to
const OPENERS = { win32: "explorer.exe", darwin: "open" }; // as src/bin/index.ts opens wio ui

const root = path.resolve(process.argv[2] ?? "fixtures");
const api = await startUiServer({ root, port: API_PORT });
let vite;

try {
  vite = await createServer({
    root: fileURLToPath(new URL("../ui/", import.meta.url)),
    plugins: [
      {
        name: "wio-ui-server",
        async closeServer({ reason }) {
          if (reason === "close") {
            await api.close(); // vite exits once closed on SIGTERM, so the api closes as part of that
          }
        },
      },
    ],
  });
  await vite.listen();
} catch (error) {
  await (vite?.close() ?? api.close());
  throw error;
}

process.once("SIGINT", () => {
  void vite.close().finally(() => process.exit(130));
});

const signIn = new URL(api.url); // the api's address with the token, through the proxy on vite's port

signIn.port = String(vite.config.server.port);
const page = path.join(path.dirname(api.openFile), "dev.html"); // beside wio ui's own page, where only this user can read the token

await writeFile(page, forwardingPage(signIn.href), { mode: 0o600 });
vite.printUrls();
console.log(`  API:     wio ui serving ${root}\n  Sign in: ${signIn}\n`);
spawn(OPENERS[process.platform] ?? "xdg-open", [pathToFileURL(page).href], {
  detached: true,
  stdio: "ignore",
})
  .on("error", () => undefined) // the sign-in address is printed above
  .unref();
