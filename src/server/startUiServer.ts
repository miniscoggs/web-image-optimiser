import type { UiServer, UiServerOptions } from "./types.js";

/**
 * Starts the local server behind `wio ui`, which serves the comparison UI and its API on
 * 127.0.0.1 only.
 *
 * The address it returns holds a random session token. Opening it stores the token in a
 * cookie, and every other request needs that cookie, so other users on the machine can't use
 * the API. It refuses requests that come from other pages, which browsers also send the cookie
 * with, and sends no CORS headers. The API reads only the images in `root` and in a temp folder
 * of its own, where uploads, runs and re-encodes go. It writes into `root` only when the UI's
 * Write saves an output there, by the CLI's rules: never larger than the original, and
 * replacing the original or another file only when asked. `close` removes the temp folder.
 *
 * @param options - The folder to serve, and the port.
 * @returns The address, `openFile` (a page only the current user can read that forwards to
 * it, to open in a browser without putting the token on a command line), and a function that
 * stops the server.
 * @throws Error when `root` isn't a folder or the port can't be used.
 *
 * @example
 * ```ts
 * import { startUiServer } from "web-image-optimiser";
 *
 * const server = await startUiServer({ root: "photos" });
 * console.log(`Open ${server.url}`);
 * process.once("SIGINT", () => void server.close());
 * ```
 */
async function startUiServer(options: UiServerOptions): Promise<UiServer> {
  const { default: listen } = await import("./listen.js"); // zod and the routes load only when a server starts

  return listen(options);
}

export default startUiServer;
