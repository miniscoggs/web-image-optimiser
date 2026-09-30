import { BrowserWindow, app, session, shell } from "electron";
import type { WebContents } from "electron";
import { fileURLToPath } from "node:url";
import { isAppUrl } from "./appScheme.js";

/**
 * Opens a web link in the system's browser, and ignores any other.
 *
 * @param url - The link.
 */
function openExternal(url: string) {
  const protocol = URL.parse(url)?.protocol;

  if (protocol === "https:" || protocol === "http:") {
    void shell.openExternal(url);
  }
}

/**
 * Keeps a page on the app's origin: it can't navigate away, open windows or attach webviews,
 * and a web link it follows opens in the system's browser instead.
 *
 * @param contents - The page.
 */
function guardContents(contents: WebContents) {
  contents.on("will-navigate", (event) => {
    if (!isAppUrl(event.url)) {
      event.preventDefault();
      openExternal(event.url);
    }
  });
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
}

/**
 * Guards every page the app makes, and refuses every permission a page asks for, such as the
 * camera or notifications, which the app never needs.
 */
function guardPages() {
  app.on("web-contents-created", (_event, contents) => {
    guardContents(contents);
  });
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => {
      callback(false);
    }
  );
}

/**
 * Creates the app's one window, isolated and sandboxed with no Node in the page, which it shows
 * once the page has drawn.
 */
function createAppWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: "Web Image Optimiser",
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/index.cjs", import.meta.url)),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  window.once("ready-to-show", () => {
    window.show();
  });
  return window;
}

export { createAppWindow, guardPages };
