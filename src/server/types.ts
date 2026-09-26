/**
 * Options for {@link startUiServer}.
 *
 * @example
 * ```ts
 * import type { UiServerOptions } from "web-image-optimiser";
 *
 * const options: UiServerOptions = { root: "photos", port: 8080 };
 * ```
 */
type UiServerOptions = {
  /** The folder whose images the UI lists. It is the only folder the server reads from or writes to, besides a temp folder of its own. */
  root: string;
  /** The port to listen on. Defaults to 0, a free one. */
  port?: number;
};

/**
 * A running UI server, from {@link startUiServer}.
 *
 * @example
 * ```ts
 * import { startUiServer, type UiServer } from "web-image-optimiser";
 *
 * const server: UiServer = await startUiServer({ root: "photos" });
 * console.log(server.url);
 * await server.close();
 * ```
 */
type UiServer = {
  /** The address to open, which holds the session token. */
  url: string;
  /** A page only the current user can read that forwards to `url`. Opening it rather than the address keeps the token off the browser's command line, where other users can read it. */
  openFile: string;
  /** Stops the server: stops a run in progress, waits for it to clean up, and removes the temp folder. */
  close: () => Promise<void>;
};

export type { UiServer, UiServerOptions };
