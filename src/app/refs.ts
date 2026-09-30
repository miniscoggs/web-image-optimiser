import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { formatOfExtension, relativeInside } from "../pipeline/destination.js";
import ApiError from "./ApiError.js";
import type { AppOpenedFiles } from "./openedFiles.js";

/**
 * Where the API's refs lead: the files the desktop app opened, as `file/` refs, and the API's
 * temp folder, a real path, as `session/` refs.
 */
type AppRefs = {
  opened: Pick<AppOpenedFiles, "pathOf">;
  session: string;
};

/**
 * A kind of ref: an opened file, or a file in the temp folder.
 */
type AppRefArea = "file" | "session";

const OUTPUT_FOLDERS = new Set(["runs", "searches", "rights"]); // the temp folders that hold outputs, rather than diff maps

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
 * Returns the ref of a path in the API's temp folder: `session/`, then its path there with `/`
 * separators, eg `session/runs/1/0/a.webp`.
 *
 * @param filePath - The path.
 * @param session - The temp folder.
 * @throws Error when the path is outside it.
 */
function refOf(filePath: string, session: string) {
  const relative = relativeInside(session, filePath);

  if (relative === undefined) {
    throw new Error(`${filePath} is outside the app's temp folder`);
  }
  return ["session", ...relative.split(path.sep)].join("/");
}

/**
 * Resolves an opened file's ref to its real path, while it is still a file.
 *
 * @param ref - The ref.
 * @param refs - Where refs lead.
 */
async function resolveOpened(ref: string, refs: AppRefs) {
  const filePath = refs.opened.pathOf(ref); // looked up, never joined, so it can't climb out
  const stats =
    filePath === undefined
      ? undefined
      : await lstat(filePath).catch(() => undefined); // a link put in its place since isn't followed

  if (filePath === undefined || stats?.isFile() !== true) {
    throw new ApiError(404, `No such image: ${ref}`);
  }
  return filePath;
}

/**
 * Resolves a ref in the temp folder to an image's real path there.
 *
 * @param ref - The ref.
 * @param parts - Its parts after `session`.
 * @param refs - Where refs lead.
 */
async function resolveSession(ref: string, parts: string[], refs: AppRefs) {
  const filePath = path.join(refs.session, ...parts);
  const real =
    formatOfExtension(filePath) === undefined
      ? undefined
      : await realpath(filePath).catch(() => undefined);
  const stats = real === undefined ? undefined : await stat(real);

  if (
    real === undefined ||
    relativeInside(refs.session, real) === undefined ||
    stats?.isFile() !== true
  ) {
    throw new ApiError(404, `No such image: ${ref}`);
  }
  return real;
}

/**
 * Resolves a ref to the real path of a file the API may read: a file the desktop app opened, or
 * an image in the API's temp folder.
 *
 * @param ref - The ref.
 * @param refs - Where refs lead.
 * @param areas - The kinds of ref allowed.
 * @returns The file's real path, which is the one checked, so a link changed afterwards can't
 * redirect it.
 * @throws {@link ApiError} 400 when the ref is malformed, climbs out of the temp folder or is of
 * a kind not allowed, and 404 when there is no such image, including a file that wasn't opened,
 * a file in the temp folder without an image's extension, and a link that leads out of it.
 */
async function resolveRef(
  ref: string,
  refs: AppRefs,
  areas: readonly AppRefArea[] = ["file", "session"]
) {
  const [area, ...parts] = ref.split("/");

  if (!areas.some((allowed) => allowed === area) || parts.length === 0) {
    throw new ApiError(400, `Not a file reference: ${ref}`);
  }
  if (area === "file") {
    return resolveOpened(ref, refs);
  }
  if (!parts.every(isPlainPart)) {
    throw new ApiError(400, `Not a file reference: ${ref}`);
  }
  return resolveSession(ref, parts, refs);
}

/**
 * Resolves the ref of an output that may be saved: one from a run, a search or `/api/rights`, in
 * the API's temp folder.
 *
 * @param ref - The ref.
 * @param refs - Where refs lead.
 * @throws {@link ApiError} as {@link resolveRef} does, and 400 for any other ref.
 */
async function resolveOutput(ref: string, refs: AppRefs) {
  const [, folder = ""] = ref.split("/");

  if (!OUTPUT_FOLDERS.has(folder)) {
    throw new ApiError(400, `Not an output: ${ref}`);
  }
  return resolveRef(ref, refs, ["session"]);
}

export { refOf, resolveOutput, resolveRef };
export type { AppRefArea, AppRefs };
