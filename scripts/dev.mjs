// Runs the desktop app in development: builds its main process and preload, serves the page
// with hot reload from Vite on 127.0.0.1:5173, and launches Electron, whose wio: protocol passes
// the page's requests on to Vite. The app API runs from dist, which `npm run dev` builds first,
// so run it again after changing src/ or desktop/. Quit the app to stop: Ctrl+C stops it at once,
// which can leave its temp folder behind. Usage: npm run dev
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { build, createServer } from "vite";

const HOST = "127.0.0.1";
const PORT = 5173;

const pathOf = (relative) => fileURLToPath(new URL(relative, import.meta.url));

for (const config of ["vite.main.config.ts", "vite.preload.config.ts"]) {
  await build({ configFile: pathOf(`../desktop/${config}`) });
}

const vite = await createServer({
  root: pathOf("../ui/"),
  server: {
    host: HOST,
    port: PORT,
    strictPort: true,
    hmr: { host: HOST, port: PORT }, // the page's own origin is wio://app
  },
});

await vite.listen();

const env = { ...process.env, WIO_DEV_SERVER: `http://${HOST}:${PORT}` };

delete env.ELECTRON_RUN_AS_NODE; // set when run from inside another electron app, such as an editor

const app = spawn(electron, ["."], {
  cwd: pathOf("../"),
  env,
  stdio: "inherit",
});

app.on("exit", (code) => {
  void vite.close().finally(() => process.exit(code ?? 0));
});
process.once("SIGINT", () => {
  app.kill("SIGINT");
});
