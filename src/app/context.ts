import type { AppDiffResponse, AppSearchResponse } from "./api.js";
import type { PixelRunner } from "./createPixelRunner.js";
import type { AppRefs } from "./refs.js";

/**
 * A kind of folder in the app API's temp folder.
 */
type AppSessionFolder = "runs" | "searches" | "diffs" | "rights";

/**
 * The app API's state, shared by its routes.
 */
type AppContext = {
  refs: AppRefs;
  /** Aborts when the API closes. */
  stopped: AbortSignal;
  pixels: PixelRunner;
  /** The run in progress, if any: a function that stops it, and a promise that settles once it has finished and cleaned up. */
  run: { stop: () => void; finished: Promise<void> } | undefined;
  /** Returns a new, numbered folder of a kind in the temp folder, which isn't created yet. */
  nextFolder: (kind: AppSessionFolder) => string;
  /** Searches by file and its version, format and settings. */
  searches: Map<string, Promise<AppSearchResponse>>;
  /** Diff maps by original and candidate, with their versions, and the maximum width. */
  diffs: Map<string, Promise<AppDiffResponse>>;
};

export type { AppContext };
