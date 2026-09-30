import type {
  AppApiError,
  AppOpenedFile,
  AppOptions,
  AppSaveOutputRefs,
  AppSaveSuites,
  AppSavedOutput,
  AppSavedSuiteFile,
} from "../../src/app/api.js";

// the bridge the desktop app's preload gives the page as window.wio. its main process answers
// every call and chooses every path, through the os's own dialogs, so the page only ever holds
// refs

/**
 * A dialog the user dismissed, so nothing happened.
 */
type DesktopCanceled = { outcome: "canceled" };

/**
 * A save that failed, with the optimiser's code when the image was the problem.
 */
type DesktopFailed = { outcome: "failed" } & AppApiError;

/**
 * Files opened, in the order given: each image's ref, or why a file wasn't opened.
 */
type DesktopOpened = { outcome: "opened"; files: AppOpenedFile[] };

/**
 * An output saved where the save dialog chose.
 */
type DesktopSavedOutput = { outcome: "saved" } & AppSavedOutput;

/**
 * Outputs saved into the folder the picker chose, which `folder` gives, for people.
 */
type DesktopSavedSuites = {
  outcome: "saved";
  folder: string;
  files: AppSavedSuiteFile[];
};

/**
 * A menu command that only the page can carry out.
 */
type DesktopMenuCommand = "save-all";

/**
 * The desktop app's main process, as the page reaches it.
 */
type DesktopBridge = {
  /** Shows the open dialog in the last folder images were opened from, and opens the files chosen. */
  openFiles: () => Promise<DesktopOpened | DesktopCanceled>;
  /** Opens files dropped on the page. */
  openDropped: (files: File[]) => Promise<DesktopOpened>;
  /** Shows the save dialog in the original's folder, with the output named as `wio` names it, then saves it there. */
  saveOutput: (
    refs: AppSaveOutputRefs
  ) => Promise<DesktopSavedOutput | DesktopCanceled | DesktopFailed>;
  /** Shows a folder picker in the first original's folder, then saves every output given into it, with free names. */
  saveSuites: (
    suites: AppSaveSuites
  ) => Promise<DesktopSavedSuites | DesktopCanceled | DesktopFailed>;
  /** Returns the options bar's values from the last time they changed. */
  loadOptions: () => Promise<AppOptions>;
  /** Remembers the options bar's values, dropping any field a run wouldn't take. */
  saveOptions: (options: AppOptions) => Promise<void>;
  /** Calls back with files the app opened itself, from its menu or the OS, including any opened before the page subscribed. Returns a function that unsubscribes. */
  onFilesOpened: (callback: (opened: DesktopOpened) => void) => () => void;
  /** Calls back with a menu command. Returns a function that unsubscribes. */
  onMenuCommand: (
    callback: (command: DesktopMenuCommand) => void
  ) => () => void;
};

declare global {
  interface Window {
    /** The desktop app's main process. */
    readonly wio: DesktopBridge;
  }
}

export type {
  DesktopBridge,
  DesktopCanceled,
  DesktopFailed,
  DesktopMenuCommand,
  DesktopOpened,
  DesktopSavedOutput,
  DesktopSavedSuites,
};
