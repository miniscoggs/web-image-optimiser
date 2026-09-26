import { stat } from "node:fs/promises";
import path from "node:path";
import { convertPathToPattern, glob, isDynamicPattern } from "tinyglobby";
import {
  EXTENSIONS,
  IGNORES_CASE,
  comparablePath,
  formatOfExtension,
  outputPath,
  primaryFormats,
} from "../pipeline/destination.js";
import type { PipelineBatchInput, PipelineMode } from "../pipeline/index.js";

/**
 * How to expand the CLI's inputs.
 */
type ExpandOptions = {
  /** Whether folders include their subfolders. */
  recursive: boolean;
  /** The output folder, which a scan mirrors subfolders into. */
  outDir: string | undefined;
  /** The mode, whose earlier outputs a scan leaves out. */
  mode: PipelineMode;
};

/**
 * An input found in the CLI's arguments.
 */
type FoundInput = {
  path: string;
  /** Its own output folder, mirroring the subfolder a scan found it in. */
  outDir: string | undefined;
  /** Whether a folder or glob found it, rather than being named. */
  scanned: boolean;
};

const IMAGE_PATTERN = `*.{${Object.values(EXTENSIONS)
  .flat()
  .map((extension) => extension.slice(1))
  .join(",")}}`;

/**
 * Returns the output folder for an input found in a subfolder: the same subfolder of the output
 * folder, if there is one.
 *
 * @param outDir - The output folder, if any.
 * @param subfolder - The subfolder, relative to where the scan started.
 */
function mirror(outDir: string | undefined, subfolder: string) {
  return outDir === undefined ? undefined : path.join(outDir, subfolder);
}

/**
 * Returns the path of a folder inside another, relative to it, or `undefined` when it isn't
 * inside.
 *
 * @param parent - The outer folder.
 * @param child - The folder that may be inside it.
 */
function relativeInside(parent: string, child: string) {
  const relative = path.relative(comparablePath(parent), comparablePath(child));
  const outside =
    relative === "" ||
    path.isAbsolute(relative) ||
    relative.split(path.sep)[0] === "..";

  return outside ? undefined : relative;
}

/**
 * Lists the images in a folder by extension, whatever its case, leaving out the output folder.
 *
 * @param folder - The folder.
 * @param options - Whether to include subfolders, and the output folder.
 */
async function scanFolder(
  folder: string,
  options: ExpandOptions
): Promise<FoundInput[]> {
  const pattern = options.recursive ? `**/${IMAGE_PATTERN}` : IMAGE_PATTERN;
  const outDirInside =
    options.outDir === undefined
      ? undefined
      : relativeInside(folder, options.outDir);
  const matches = await glob(pattern, {
    cwd: folder,
    caseSensitiveMatch: false,
    expandDirectories: false,
    ignore:
      outDirInside === undefined
        ? []
        : [`${convertPathToPattern(outDirInside)}/**`], // a re-run mustn't take its own outputs as inputs
  });

  return matches.map((match) => ({
    path: path.join(folder, match),
    outDir: mirror(options.outDir, path.dirname(match)),
    scanned: true,
  }));
}

/**
 * Lists the images a glob pattern matches by extension, mirroring the subfolders below the
 * pattern's fixed start.
 *
 * @param pattern - The pattern, with `/` separators.
 * @param options - The output folder.
 */
async function globImages(
  pattern: string,
  options: ExpandOptions
): Promise<FoundInput[]> {
  const parts = pattern.split("/");
  const fixed = parts.slice(
    0,
    parts.findIndex((part) => isDynamicPattern(part))
  );
  const base = fixed.length === 0 ? "." : fixed.join("/") || "/";
  const matches = await glob(pattern, {
    absolute: path.isAbsolute(pattern),
    caseSensitiveMatch: !IGNORES_CASE,
    expandDirectories: false,
  });

  return matches
    .filter((match) => formatOfExtension(match) !== undefined)
    .map((match) => {
      const filePath = path.normalize(match);
      const subfolder = path.dirname(path.relative(base, filePath));

      return {
        path: filePath,
        outDir: mirror(options.outDir, subfolder),
        scanned: true,
      };
    });
}

/**
 * Expands one argument: a folder into its images, a glob pattern into the images it matches,
 * and anything else into itself.
 *
 * @param input - The argument.
 * @param options - How to expand it.
 */
async function expandInput(
  input: string,
  options: ExpandOptions
): Promise<FoundInput[]> {
  const stats = await stat(input).catch(() => undefined);

  if (stats?.isDirectory() === true) {
    return scanFolder(input, options);
  }

  const pattern = path.sep === "\\" ? input.replaceAll("\\", "/") : input; // globs use / and a windows path can't hold a literal \

  if (stats === undefined && isDynamicPattern(pattern)) {
    const matches = await globImages(pattern, options);

    if (matches.length > 0) {
      return matches;
    }
  }
  return [{ path: input, outDir: undefined, scanned: false }]; // like a shell, an unmatched pattern stays as it is, and fails as a missing file
}

/**
 * Leaves out scanned files in the mode's WebP or AVIF format that have the name another input
 * would give that output beside itself, eg the `photo.webp` beside `photo.jpg`, taking them for
 * an earlier run's outputs. A re-run then skips the file it wrote, or writes it elsewhere,
 * instead of failing. Named files always stay.
 *
 * @param found - The inputs found.
 * @param mode - The mode.
 */
function withoutEarlierOutputs(found: FoundInput[], mode: PipelineMode) {
  const claimed = new Set<string>();

  for (const input of found) {
    const format = formatOfExtension(input.path);
    const formats = format === undefined ? [] : primaryFormats(format, mode);

    if (format === undefined || formats.includes(format)) {
      continue; // an svg, same mode, or a file in one of the mode's own formats writes only itself
    }
    for (const each of formats) {
      claimed.add(comparablePath(outputPath(input.path, each, undefined)));
    }
  }
  return found.filter(
    (input) => !input.scanned || !claimed.has(comparablePath(input.path))
  );
}

/**
 * Expands the CLI's input arguments into the files to optimise.
 *
 * A folder gives the images at its top level, found by extension (`.png`, `.jpg`, `.jpeg`,
 * `.webp`, `.avif` or `.svg`, in any case), and those in its subfolders too when `recursive` is
 * set. A glob pattern gives the images it matches, matched case-insensitively on Windows and
 * macOS. Anything else, including a pattern that matches nothing, is passed on as a path, so a
 * missing file fails with `E_READ`. With an output folder, each scanned file's outputs go in the
 * matching subfolder of it, and a scan leaves out the output folder itself. A scan also leaves
 * out a file in the mode's WebP or AVIF format named like another input beside it, such as
 * `photo.webp` beside `photo.jpg`, as an earlier run's output. The result lists each file once,
 * sorted by path.
 *
 * @param inputs - The arguments: files, folders and glob patterns.
 * @param options - Whether folders include subfolders, the output folder and the mode.
 * @returns The files, with an output folder of their own where a scan mirrors a subfolder.
 *
 * @example
 * ```ts
 * import expandInputs from "./expandInputs.js";
 *
 * const inputs = await expandInputs(["photos"], { recursive: true, outDir: "web", mode: "webp" });
 * ```
 */
async function expandInputs(
  inputs: string[],
  options: ExpandOptions
): Promise<PipelineBatchInput[]> {
  const found: FoundInput[] = [];
  const unique = new Map<string, FoundInput>();

  for (const input of inputs) {
    found.push(...(await expandInput(input, options)));
  }
  for (const input of withoutEarlierOutputs(found, options.mode)) {
    const key = comparablePath(input.path);

    if (!unique.has(key)) {
      unique.set(key, input);
    }
  }
  return [...unique]
    .toSorted(([first], [second]) => (first < second ? -1 : 1))
    .map(([, input]) =>
      input.outDir === undefined
        ? input.path
        : { path: input.path, outDir: input.outDir }
    );
}

export default expandInputs;
export type { ExpandOptions };
