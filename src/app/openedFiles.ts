import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import sniffFormat from "../inspect/sniffFormat.js";
import { comparablePath } from "../pipeline/destination.js";
import type { AppOpenedFile } from "./api.js";

/**
 * The files the desktop app opened, the only ones outside its temp folder the API reads.
 */
type AppOpenedFiles = {
  /** Opens files by their paths, giving each image a `file/` ref, the same one whenever it's opened again, or saying why it isn't one. */
  open: (paths: string[]) => Promise<AppOpenedFile[]>;
  /** Returns the real path an opened file's ref names, if any. */
  pathOf: (ref: string) => string | undefined;
};

/**
 * Creates an empty set of {@link AppOpenedFiles}.
 */
function createOpenedFiles(): AppOpenedFiles {
  const paths = new Map<string, string>(); // real path by ref
  const opened = new Map<string, { ref: string; name: string }>(); // by comparable real path

  const openOne = async (filePath: string): Promise<AppOpenedFile> => {
    const real = await realpath(filePath).catch(() => undefined);
    const stats =
      real === undefined ? undefined : await stat(real).catch(() => undefined);
    const name = path.basename(real ?? filePath);

    if (real === undefined || stats === undefined) {
      return { name, error: `${name} can't be found` };
    }
    if (!stats.isFile()) {
      return { name, error: `${name} isn't a file` };
    }
    if ((await sniffFormat(real)) === undefined) {
      return {
        name,
        error: `${name} isn't a PNG, JPEG, WebP, AVIF or SVG image, or can't be read`,
      };
    }

    const key = comparablePath(real);
    const known = opened.get(key);
    const entry = known ?? { ref: `file/${paths.size + 1}/${name}`, name };

    if (known === undefined) {
      opened.set(key, entry);
      paths.set(entry.ref, real);
    }
    return { ...entry, bytes: stats.size };
  };

  return {
    open: async (filePaths) => {
      const results: AppOpenedFile[] = [];

      for (const filePath of filePaths) {
        results.push(await openOne(filePath)); // in turn, so refs are numbered in the order given
      }
      return results;
    },
    pathOf: (ref) => paths.get(ref),
  };
}

export default createOpenedFiles;
export type { AppOpenedFiles };
