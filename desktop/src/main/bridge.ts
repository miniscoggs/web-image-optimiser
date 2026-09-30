import { app, dialog, ipcMain } from "electron";
import type {
  BrowserWindow,
  IpcMainEvent,
  IpcMainInvokeEvent,
  OpenDialogOptions,
} from "electron";
import { stat } from "node:fs/promises";
import path from "node:path";
import {
  EXTENSIONS,
  FORMAT_NAMES,
  describeFailure,
  formatOfExtension,
} from "#app";
import type { AppApi, AppSaveOutputRefs, AppSaveSuites } from "#app";
import type {
  DesktopCanceled,
  DesktopFailed,
  DesktopMenuCommand,
  DesktopOpened,
  DesktopSavedOutput,
  DesktopSavedSuites,
} from "../../../ui/src/desktop.js";
import CHANNELS from "../channels.js";
import { isAppUrl } from "./appScheme.js";
import type { DesktopState } from "./desktopState.js";

const CANCELED: DesktopCanceled = { outcome: "canceled" };

const OPEN_DIALOG: OpenDialogOptions = {
  properties: ["openFile", "multiSelections"],
  filters: [
    {
      name: "Images",
      extensions: Object.values(EXTENSIONS)
        .flat()
        .map((extension) => extension.slice(1)),
    },
    { name: "All files", extensions: ["*"] }, // the format comes from the bytes, not the name
  ],
};

/**
 * The main process's side of the page's `window.wio`, and the one way files from main reach
 * the page.
 */
type DesktopBridgeMain = {
  /** Opens files by their paths, remembers their folder, sends them to the page, and shows the window. */
  openPaths: (paths: string[]) => Promise<void>;
  /** Shows the open dialog, as the page's Browse does, and opens what is chosen through `openPaths`. */
  chooseAndOpen: () => Promise<void>;
  /** Sends the page a menu command. */
  sendMenuCommand: (command: DesktopMenuCommand) => void;
  /** Shows and focuses the window. */
  showWindow: () => void;
};

/**
 * Returns whether a value is a list of absolute paths.
 *
 * @param value - The value.
 */
function isPathList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && path.isAbsolute(item))
  );
}

/**
 * Returns the save dialog's filters for an output: its format's extensions.
 *
 * @param defaultPath - The output's default path, whose extension names its format.
 */
function saveFilters(defaultPath: string) {
  const format = formatOfExtension(defaultPath);

  return format === undefined
    ? []
    : [
        {
          name: `${FORMAT_NAMES[format]} image`,
          extensions: EXTENSIONS[format].map((extension) => extension.slice(1)),
        },
      ];
}

/**
 * Describes a failed call for the page, with the optimiser's code when the image was the
 * problem.
 *
 * @param error - What was thrown.
 */
function failed(error: unknown): DesktopFailed {
  return { outcome: "failed", ...describeFailure(error).body };
}

/**
 * Answers the page's `window.wio` for a window: each call checks it comes from the window's own
 * page, and every path comes from an OS dialog, a drop or the app itself, never from the page.
 *
 * @param options - The app API, the remembered state and the app's window.
 * @param options.api - The app API.
 * @param options.state - What the app remembers.
 * @param options.window - The app's window.
 */
function createBridge({
  api,
  state,
  window,
}: {
  api: AppApi;
  state: DesktopState;
  window: BrowserWindow;
}): DesktopBridgeMain {
  const contents = window.webContents;
  const queued: DesktopOpened[] = [];
  let subscribed = false;

  const isAppSender = ({
    sender,
    senderFrame,
  }: IpcMainEvent | IpcMainInvokeEvent) =>
    sender === contents &&
    senderFrame === contents.mainFrame &&
    isAppUrl(senderFrame.url);
  const handle = <Args extends unknown[]>(
    channel: string,
    answer: (...args: Args) => Promise<unknown>
  ) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!isAppSender(event)) {
        throw new Error("Only the app's own page can call this");
      }
      return answer(...(args as Args));
    });
  };
  const open = async (paths: string[]): Promise<DesktopOpened> => {
    const files = await api.open(paths);
    const first = paths[files.findIndex((file) => "ref" in file)];

    if (first !== undefined) {
      await state.rememberFolder(path.dirname(first));
    }
    return { outcome: "opened", files };
  };
  const chooseFiles = async () => {
    const lastFolder = await state.lastFolder();
    const chosen = await dialog.showOpenDialog(window, {
      ...OPEN_DIALOG,
      defaultPath: lastFolder ?? app.getPath("home"),
    });

    return chosen.canceled ? undefined : chosen.filePaths;
  };
  const showWindow = () => {
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
  };
  const openPaths = async (paths: string[]) => {
    const opened = await open(paths);

    if (subscribed) {
      contents.send(CHANNELS.filesOpened, opened);
    } else {
      queued.push(opened);
    }
    showWindow();
  };

  contents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      subscribed = false; // a reload subscribes again
    }
  });
  ipcMain.on(CHANNELS.filesSubscribed, (event) => {
    if (isAppSender(event)) {
      subscribed = true;
      for (const opened of queued.splice(0)) {
        contents.send(CHANNELS.filesOpened, opened);
      }
    }
  });

  handle(CHANNELS.openFiles, async () => {
    const paths = await chooseFiles();

    return paths === undefined ? CANCELED : open(paths);
  });
  handle(CHANNELS.openDropped, async (paths: unknown) => {
    if (!isPathList(paths)) {
      throw new TypeError("Expected the dropped files' paths");
    }
    return open(paths);
  });
  handle(
    CHANNELS.saveOutput,
    async (
      refs: AppSaveOutputRefs
    ): Promise<DesktopSavedOutput | DesktopCanceled | DesktopFailed> => {
      try {
        const defaultPath = await api.savePath(refs);
        const chosen = await dialog.showSaveDialog(window, {
          defaultPath,
          filters: saveFilters(defaultPath),
          properties: ["showOverwriteConfirmation"],
        });

        if (chosen.canceled || chosen.filePath === "") {
          return CANCELED;
        }

        const replace = await stat(chosen.filePath).then(
          () => true,
          () => false
        ); // the dialog has asked already
        const saved = await api.saveOutput({
          ...refs,
          to: chosen.filePath,
          replace,
        });

        return { outcome: "saved", ...saved };
      } catch (error) {
        return failed(error);
      }
    }
  );
  handle(
    CHANNELS.saveSuites,
    async (
      suites: AppSaveSuites
    ): Promise<DesktopSavedSuites | DesktopCanceled | DesktopFailed> => {
      try {
        const defaultPath = await api.saveFolder(suites);
        const chosen = await dialog.showOpenDialog(window, {
          defaultPath,
          buttonLabel: "Save here",
          properties: ["openDirectory", "createDirectory"],
        });
        const [folder] = chosen.filePaths;

        if (chosen.canceled || folder === undefined) {
          return CANCELED;
        }
        return {
          outcome: "saved",
          folder,
          files: await api.saveSuites(suites, folder),
        };
      } catch (error) {
        return failed(error);
      }
    }
  );
  handle(CHANNELS.loadOptions, () => Promise.resolve(state.options()));
  handle(CHANNELS.saveOptions, (options: unknown) =>
    state.saveOptions(options)
  );

  return {
    openPaths,
    chooseAndOpen: async () => {
      const paths = await chooseFiles();

      if (paths !== undefined) {
        await openPaths(paths);
      }
    },
    sendMenuCommand: (command) => {
      contents.send(CHANNELS.menuCommand, command);
    },
    showWindow,
  };
}

export default createBridge;
export type { DesktopBridgeMain };
