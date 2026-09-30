import { stat } from "node:fs/promises";
import path from "node:path";
import FORMAT_NAMES from "../inspect/formatNames.js";
import {
  EXTENSIONS,
  formatOfExtension,
  isInput,
  outputPath,
  planWrites,
} from "../pipeline/destination.js";
import type { InputFile } from "../pipeline/destination.js";
import readInput from "../pipeline/readInput.js";
import writeOutputs from "../pipeline/writeOutputs.js";
import ApiError from "./ApiError.js";
import { saveOutputRequestSchema, saveSuitesRequestSchema } from "./api.js";
import type {
  AppSaveOutputRefs,
  AppSaveSuites,
  AppSavedOutput,
  AppSavedSuiteFile,
} from "./api.js";
import { createFreeNames } from "./freeName.js";
import { parseValue } from "./parseRequest.js";
import readImage from "./readImage.js";
import { resolveOutput, resolveRef } from "./refs.js";
import type { AppRefs } from "./refs.js";

/**
 * What {@link saveOutput} saves, and where: the refs, which come from the page, and the path the
 * save dialog chose, with whether its own prompt confirmed replacing a file there.
 */
type AppSaveOutputRequest = AppSaveOutputRefs & {
  to: string;
  replace: boolean;
};

/**
 * Refuses a path that isn't absolute, which would resolve against the working folder.
 *
 * @param filePath - The path.
 * @throws {@link ApiError} 400 when it isn't absolute.
 */
function assertAbsolute(filePath: string) {
  if (!path.isAbsolute(filePath)) {
    throw new ApiError(400, `Expected an absolute path, got ${filePath}`);
  }
}

/**
 * Returns whether a path is the original's own file.
 *
 * @param filePath - The path.
 * @param original - The original.
 */
async function isOriginalAt(filePath: string, original: InputFile) {
  const stats = await stat(filePath, { bigint: true }).catch(() => undefined);

  return stats !== undefined && isInput(filePath, stats, original);
}

/**
 * Reads an opened file, whose output is to be saved.
 *
 * @param ref - Its ref.
 * @param refs - Where refs lead.
 */
async function readOriginal(ref: string, refs: AppRefs) {
  const filePath = await resolveRef(ref, refs, ["file"]);

  return readInput(filePath);
}

/**
 * Reads an output to save, refusing one larger than its original.
 *
 * @param ref - The output's ref.
 * @param original - Its original.
 * @param refs - Where refs lead.
 * @throws {@link ApiError} 422 when it is larger than the original.
 */
async function readOutput(ref: string, original: InputFile, refs: AppRefs) {
  const filePath = await resolveOutput(ref, refs);
  const output = await readImage(filePath, ref);

  if (output.bytes.length > original.bytes.length) {
    throw new ApiError(
      422,
      `The ${FORMAT_NAMES[output.format]} is larger than the original, so it can't be saved`
    );
  }
  return output;
}

/**
 * Returns where a pane's save dialog starts: in the original's folder, the output named as the
 * CLI names it, or with the next free name when that's taken.
 *
 * @param request - The refs.
 * @param refs - Where refs lead.
 * @throws {@link ApiError} as {@link saveOutput} does for its refs.
 */
async function savePath(request: AppSaveOutputRefs, refs: AppRefs) {
  const { original: originalRef, candidate } = parseValue(
    request,
    saveOutputRequestSchema
  );
  const original = await readOriginal(originalRef, refs);
  const output = await readOutput(candidate, original, refs);
  const wanted = outputPath(original.path, output.format, undefined);
  const folder = path.dirname(wanted);
  const freeName = await createFreeNames(folder, process.platform);

  return path.join(folder, freeName(path.basename(wanted)));
}

/**
 * Returns where Save suite's folder picker starts: the folder of the first opened file given.
 *
 * @param suites - Each opened file's ref, with its outputs' refs.
 * @param refs - Where refs lead.
 * @throws {@link ApiError} 400 for malformed refs, and 404 when the first file wasn't opened or
 * has gone.
 */
async function saveFolder(suites: AppSaveSuites, refs: AppRefs) {
  const [first] = parseValue(suites, saveSuitesRequestSchema);

  if (first === undefined) {
    throw new ApiError(400, "Expected at least one opened file");
  }
  return path.dirname(await resolveRef(first.original, refs, ["file"]));
}

/**
 * Saves an output where the save dialog chose. It replaces a file there, the original
 * included, only with `replace`, which the dialog's own prompt confirmed.
 *
 * @param request - The refs, the path and whether it may replace a file.
 * @param refs - Where refs lead.
 * @throws {@link ApiError} 400 for a malformed ref, or a path that isn't absolute or whose
 * extension doesn't fit the output's format, 404 when a file has gone, 409 when a file is there
 * and `replace` isn't set, and 422 when the output is larger than the original; an
 * {@link OptimiserError} `E_WRITE` when it can't be written.
 */
async function saveOutput(
  request: AppSaveOutputRequest,
  refs: AppRefs
): Promise<AppSavedOutput> {
  const { original: originalRef, candidate } = parseValue(
    request,
    saveOutputRequestSchema
  );
  const { to, replace } = request;
  const name = path.basename(to);

  assertAbsolute(to);

  const original = await readOriginal(originalRef, refs);
  const output = await readOutput(candidate, original, refs);

  if (formatOfExtension(to) !== output.format) {
    throw new ApiError(
      400,
      `A ${FORMAT_NAMES[output.format]} needs a name ending in ${EXTENSIONS[output.format][0]}`
    );
  }

  const isOriginal = await isOriginalAt(to, original);
  const planned = await planWrites(
    [{ path: to, bytes: output.bytes }],
    original,
    { inPlace: replace && isOriginal, overwrite: replace && !isOriginal }
  );

  if ("blocked" in planned) {
    throw new ApiError(
      409,
      `${name} ${planned.blocked.reason === "input" ? "is the original" : "already exists"}, and replacing it wasn't confirmed`
    );
  }
  await writeOutputs(planned.writes, undefined);

  const written = planned.writes.length > 0; // not when it is the original, unchanged

  return { name, written, replacedOriginal: written && isOriginal };
}

/**
 * Saves opened files' outputs into a folder, each named as the CLI names it, or with the next
 * free name, as the OS names a copy, when that's taken, so nothing is replaced. An output that is
 * its original, unchanged, at the original's own path, such as a suite's fallback saved into the
 * original's folder, is left where it is, as the CLI leaves it. Every file is written to a temp
 * file before any is renamed into place.
 *
 * @param suites - Each opened file's ref, with its outputs' refs.
 * @param folder - The folder.
 * @param refs - Where refs lead.
 * @returns Each output saved, in the order given.
 * @throws {@link ApiError} as {@link saveOutput} does, and 409 when a file appears at a free
 * name before it is written; an {@link OptimiserError} `E_WRITE` when one can't be written.
 */
async function saveSuites(
  suites: AppSaveSuites,
  folder: string,
  refs: AppRefs
): Promise<AppSavedSuiteFile[]> {
  const parsed = parseValue(suites, saveSuitesRequestSchema);

  assertAbsolute(folder);

  const freeName = await createFreeNames(folder, process.platform);
  const writes: { path: string; bytes: Buffer }[] = [];
  const saved: AppSavedSuiteFile[] = [];

  for (const suite of parsed) {
    const original = await readOriginal(suite.original, refs);
    const files: { path: string; bytes: Buffer }[] = [];

    for (const candidate of suite.candidates) {
      const output = await readOutput(candidate, original, refs);
      const wantedPath = outputPath(original.path, output.format, folder);
      const wanted = path.basename(wantedPath);
      const unchanged =
        output.bytes.equals(original.bytes) &&
        (await isOriginalAt(wantedPath, original)); // which planWrites then skips
      const name = unchanged ? wanted : freeName(wanted);

      files.push({ path: path.join(folder, name), bytes: output.bytes });
      saved.push({ original: suite.original, candidate, name, wanted });
    }

    const planned = await planWrites(files, original, {
      inPlace: false,
      overwrite: false,
    });

    if ("blocked" in planned) {
      throw new ApiError(
        409,
        `${path.basename(planned.blocked.path)} appeared while saving`
      );
    }
    writes.push(...planned.writes);
  }
  await writeOutputs(writes, undefined);
  return saved;
}

export { saveFolder, saveOutput, savePath, saveSuites };
export type { AppSaveOutputRequest };
