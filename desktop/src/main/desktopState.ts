import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { readAppOptions } from "#app";
import type { AppOptions } from "#app";

/**
 * What the desktop app remembers between launches, in `state.json` in its user data folder.
 */
type DesktopState = {
  /** Returns the last folder images were opened from, if it is still a folder. */
  lastFolder: () => Promise<string | undefined>;
  /** Remembers the folder images were last opened from. */
  rememberFolder: (folder: string) => Promise<void>;
  /** Returns the options bar's values. */
  options: () => AppOptions;
  /** Remembers the options bar's values, dropping any field a run wouldn't take. */
  saveOptions: (options: unknown) => Promise<void>;
};

/**
 * The file's contents, as saved.
 */
type StoredState = {
  lastFolder?: string;
  options: AppOptions;
};

/**
 * Reads the stored state, keeping what is valid, and starting afresh when the file is missing
 * or unreadable.
 *
 * @param file - The file.
 */
async function readStoredState(file: string): Promise<StoredState> {
  const parsed: unknown = await readFile(file, "utf8")
    .then((text) => JSON.parse(text) as unknown)
    .catch(() => undefined);
  const stored =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  const { lastFolder } = stored;

  return {
    ...(typeof lastFolder === "string" && path.isAbsolute(lastFolder)
      ? { lastFolder }
      : {}),
    options: readAppOptions(stored.options),
  };
}

/**
 * Loads the desktop app's {@link DesktopState} from a file, which it writes back, atomically and
 * one write at a time, whenever something changes.
 *
 * @param file - The file, `state.json` in the user data folder.
 */
async function loadDesktopState(file: string): Promise<DesktopState> {
  let stored = await readStoredState(file);
  let writing = Promise.resolve();

  const save = (change: Partial<StoredState>) => {
    stored = { ...stored, ...change };

    const text = `${JSON.stringify(stored, undefined, 2)}\n`;
    const temp = `${file}.tmp`;

    writing = writing
      .then(async () => {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(temp, text);
        await rename(temp, file);
      })
      .catch(() => undefined); // a failed write only forgets a preference
    return writing;
  };

  return {
    lastFolder: async () => {
      const folder = stored.lastFolder;
      const stats =
        folder === undefined
          ? undefined
          : await stat(folder).catch(() => undefined);

      return stats?.isDirectory() === true ? folder : undefined;
    },
    rememberFolder: (folder) => save({ lastFolder: folder }),
    options: () => stored.options,
    saveOptions: (options) => save({ options: readAppOptions(options) }),
  };
}

export default loadDesktopState;
export type { DesktopState };
