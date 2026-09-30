import { app, dialog, protocol } from "electron";
import path from "node:path";
import { createAppApi } from "#app";
import type { AppApi } from "#app";
import setAppMenu from "./appMenu.js";
import registerAppProtocol from "./appProtocol.js";
import { APP_SCHEME, APP_URL } from "./appScheme.js";
import { createAppWindow, guardPages } from "./appWindow.js";
import createBridge from "./bridge.js";
import type { DesktopBridgeMain } from "./bridge.js";
import commandLineFiles from "./commandLineFiles.js";
import loadDesktopState from "./desktopState.js";

// the desktop app's main process. electron fires ready only once this module has run, so it
// never awaits ready at the top level

/**
 * Closes the app API before the app quits, which stops a run and removes its temp folder.
 *
 * @param api - The app API.
 */
function closeOnQuit(api: AppApi) {
  let closed = false;

  app.on("before-quit", (event) => {
    if (!closed) {
      event.preventDefault();
      void api.close().finally(() => {
        closed = true;
        app.quit();
      });
    }
  });
  app.on("window-all-closed", () => {
    app.quit(); // on macOS too: the app is its one window
  });
}

/**
 * Opens the files the OS hands the app: on its command line, on a second launch's, which also
 * shows the window, and through macOS's `open-file`, which a drop on the Dock icon sends too.
 * Each can arrive before the page has loaded, so they wait for it.
 *
 * @returns A function to call with the bridge once the page has loaded.
 */
function receiveFiles() {
  const waiting: string[] = [];
  let bridge: DesktopBridgeMain | undefined;

  const receive = (paths: string[]) => {
    if (bridge === undefined) {
      waiting.push(...paths);
    } else if (paths.length > 0) {
      void bridge.openPaths(paths);
    }
  };
  const readCommandLine = async (argv: string[], cwd: string) => {
    receive(
      await commandLineFiles(argv, { cwd, namesApp: process.defaultApp })
    );
  };

  app.on("open-file", (event, filePath) => {
    event.preventDefault(); // tells macos the app has taken it
    receive([filePath]);
  });
  app.on("second-instance", (_event, argv, workingDirectory) => {
    bridge?.showWindow();
    void readCommandLine(argv, workingDirectory);
  });
  void readCommandLine(process.argv, process.cwd());

  return (loaded: DesktopBridgeMain) => {
    bridge = loaded;
    receive(waiting.splice(0));
  };
}

/**
 * Starts the app once Electron is ready: the app API, the protocol that serves it and the page,
 * the window, the bridge and the menu, then opens the files the OS has sent.
 *
 * @param devServer - Vite's address, in development.
 * @param openReceived - Opens the files the OS sends through the bridge, from `receiveFiles`.
 */
async function start(
  devServer: string | undefined,
  openReceived: (bridge: DesktopBridgeMain) => void
) {
  const api = await createAppApi();

  closeOnQuit(api);

  const state = await loadDesktopState(
    path.join(app.getPath("userData"), "state.json")
  );

  registerAppProtocol(api, devServer);
  guardPages();

  const window = createAppWindow();
  const bridge = createBridge({ api, state, window });

  setAppMenu({
    chooseAndOpen: () => void bridge.chooseAndOpen(),
    saveAll: () => {
      bridge.sendMenuCommand("save-all");
    },
    development: !app.isPackaged,
  });
  await window.loadURL(APP_URL);
  openReceived(bridge); // after the load, since opening shows the window, which waits to draw
}

app.enableSandbox();
protocol.registerSchemesAsPrivileged([APP_SCHEME]);

if (app.requestSingleInstanceLock()) {
  const devServer = app.isPackaged ? undefined : process.env.WIO_DEV_SERVER; // set by scripts/dev.mjs
  const openReceived = receiveFiles(); // before ready, which macos's open-file can precede

  void app
    .whenReady()
    .then(() => start(devServer, openReceived))
    .catch((error: unknown) => {
      dialog.showErrorBox(
        "Web Image Optimiser couldn't start",
        error instanceof Error ? error.message : String(error)
      );
      app.quit(); // rather than exit, so the api closes
    });
} else {
  app.quit(); // the running app takes over, and opens this one's files, through second-instance
}
