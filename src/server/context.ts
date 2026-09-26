import type { ServerDiffResponse, ServerEncodeResponse } from "./api.js";
import type { PixelRunner } from "./createPixelRunner.js";
import type { ServerFolders } from "./refs.js";

/**
 * A kind of folder in the server's temp folder.
 */
type ServerSessionFolder = "uploads" | "runs" | "encodes" | "diffs";

/**
 * A running server's state, shared by its routes.
 */
type ServerContext = {
  folders: ServerFolders;
  /** The session token, which the address carries and the cookie then holds. */
  token: string;
  /** The session cookie's name. */
  cookie: string;
  /** Aborts when the server closes. */
  stopped: AbortSignal;
  pixels: PixelRunner;
  /** The run in progress, if any: a function that stops it, and a promise that settles once it has finished and cleaned up. */
  run: { stop: () => void; finished: Promise<void> } | undefined;
  /** Returns a new, numbered folder of a kind in the temp folder, which isn't created yet. */
  nextFolder: (kind: ServerSessionFolder) => string;
  /** Re-encodes by file and its version, format and quality. */
  encodes: Map<string, Promise<ServerEncodeResponse>>;
  /** Diff maps by original and candidate, with their versions. */
  diffs: Map<string, Promise<ServerDiffResponse>>;
};

export type { ServerContext };
