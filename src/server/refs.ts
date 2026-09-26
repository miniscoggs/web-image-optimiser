import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { formatOfExtension, relativeInside } from "../pipeline/destination.js";
import ApiError from "./ApiError.js";

/**
 * The folders the API reads from, as real paths: `root`, the folder being served, and
 * `session`, the server's own temp folder of uploads, runs, re-encodes and diff maps.
 */
type ServerFolders = { root: string; session: string };

const AREAS = ["session", "root"] as const; // the session folder first, since it can sit inside the root

/**
 * Returns whether a value names one of the {@link ServerFolders}.
 *
 * @param value - The value.
 */
function isArea(value: string | undefined): value is keyof ServerFolders {
  return AREAS.some((area) => area === value);
}

/**
 * Returns whether one part of a `/`-separated path names a file or folder by itself, rather
 * than being empty, `.`, `..` or holding a backslash or NUL.
 *
 * @param part - The part.
 */
function isPlainPart(part: string) {
  return part !== "" && part !== "." && part !== ".." && !/[\\\0]/.test(part);
}

/**
 * Returns the reference the API uses for a path in one of its folders: the folder's name, then
 * the path inside it with `/` separators, eg `root/photos/a.jpg` or `session/runs/1/0/a.webp`.
 *
 * @param filePath - The path.
 * @param folders - The server's folders.
 * @throws Error when the path is in neither folder.
 */
function refOf(filePath: string, folders: ServerFolders) {
  for (const area of AREAS) {
    const relative = relativeInside(folders[area], filePath);

    if (relative !== undefined) {
      return [area, ...relative.split(path.sep)].join("/");
    }
  }
  throw new Error(`${filePath} is outside the server's folders`);
}

/**
 * Resolves a reference from {@link refOf} to the real path of an image in one of the server's
 * folders.
 *
 * @param ref - The reference.
 * @param folders - The server's folders.
 * @returns The image's real path, which is the one checked, so a link changed afterwards can't
 * redirect it.
 * @throws {@link ApiError} 400 when the reference is malformed or climbs out of its folder,
 * and 404 when there is no such image, including a file without an image's extension and a
 * link that leads outside the folder.
 */
async function resolveRef(ref: string, folders: ServerFolders) {
  const [area, ...parts] = ref.split("/");

  if (!isArea(area) || parts.length === 0 || !parts.every(isPlainPart)) {
    throw new ApiError(400, `Not a file reference: ${ref}`);
  }

  const filePath = path.join(folders[area], ...parts);
  const real =
    formatOfExtension(filePath) === undefined
      ? undefined
      : await realpath(filePath).catch(() => undefined);
  const stats = real === undefined ? undefined : await stat(real);

  if (
    real === undefined ||
    relativeInside(folders[area], real) === undefined ||
    stats?.isFile() !== true
  ) {
    throw new ApiError(404, `No such image: ${ref}`);
  }
  return real;
}

export { isPlainPart, refOf, resolveRef };
export type { ServerFolders };
