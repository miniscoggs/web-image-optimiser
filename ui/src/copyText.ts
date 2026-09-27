import type { PipelineFileResult } from "../../src/pipeline/types.js";
import type { RunOptions } from "./api.js";
import { displayName } from "./refs.js";
import type { RunFile } from "./runState.js";

const PLAIN_ARGUMENT = /^[\w./+-]+$/; // needs no quotes in any shell

const POWERSHELL_QUOTES = /['\u2018\u2019\u201A\u201B]/g; // powershell ends a single-quoted string at any of these

/**
 * Quotes a file name for the shell of the machine serving the UI: single quotes for POSIX
 * shells, and for PowerShell on Windows, since nothing inside them expands in either. A name
 * starting with `-` gets `./` in front, so it isn't read as a flag.
 *
 * @param name - The file name, or its path in the folder served.
 * @param windows - Whether the machine runs Windows.
 */
function quote(name: string, windows: boolean) {
  const argument = name.startsWith("-") ? `./${name}` : name;

  if (PLAIN_ARGUMENT.test(argument)) {
    return argument;
  }
  return windows
    ? `'${argument.replaceAll(POWERSHELL_QUOTES, "$&$&")}'`
    : `'${argument.replaceAll("'", `'\\''`)}'`;
}

/**
 * Returns the `wio` command that writes what a run in the UI previews, to run in the folder
 * served. An upload is named by its file name alone, since only the person knows its folder.
 *
 * @param refs - The files to run.
 * @param options - The mode and target.
 * @param root - The folder served, as an absolute path.
 */
function cliCommand(refs: string[], options: RunOptions, root: string) {
  const windows = /^([A-Za-z]:[\\/]|\\\\)/.test(root);
  const inputs = refs.map((ref) => quote(displayName(ref), windows));

  return [
    "wio",
    ...inputs,
    "--to",
    options.to,
    "--target",
    String(options.target),
  ].join(" ");
}

/**
 * Returns a suite run's markup as `wio --markup` prints it: each file's, after a comment naming
 * it. It is empty when no file has any.
 *
 * @param files - The run's finished files.
 */
function markupText(files: PipelineFileResult[]) {
  return files
    .filter((file) => file.markup !== undefined)
    .map((file) => `<!-- ${displayName(file.input)} -->\n${file.markup}\n`)
    .join("\n");
}

/**
 * Returns "1 file" or "<n> files".
 *
 * @param count - How many.
 */
function filesCount(count: number) {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

/**
 * Describes the files a finished run's copied command would fail or skip, since the command
 * writes beside the originals where the run's temp folders held nothing: a sentence with the
 * flag that allows each, and a line per file. It is `undefined` when the command would write
 * every file as the run did.
 *
 * @param files - The run's files.
 */
function cliBlockNote(files: RunFile[]) {
  const blocked = files.flatMap(({ ref, cliBlock }) =>
    cliBlock === undefined ? [] : [{ ref, block: cliBlock }]
  );
  const failing = blocked.filter(({ block }) => block.reason === "input");
  const skipping = blocked.length - failing.length;
  const outcomes: string[] = [];

  if (blocked.length === 0) {
    return undefined;
  }
  if (failing.length > 0) {
    outcomes.push(
      `fail ${filesCount(failing.length)}, whose ${failing.length === 1 ? "output replaces its original" : "outputs replace their originals"} (add --in-place to allow it)`
    );
  }
  if (skipping > 0) {
    outcomes.push(
      `skip ${filesCount(skipping)}, whose ${skipping === 1 ? "output exists" : "outputs exist"} (add --overwrite to replace ${skipping === 1 ? "it" : "them"})`
    );
  }
  return {
    summary: `Run as copied, this command would ${outcomes.join(", and ")}:`,
    lines: blocked.map(({ ref, block }) => ({
      ref,
      text:
        block.reason === "input"
          ? `${displayName(ref)} fails`
          : `${displayName(ref)} is skipped, as ${displayName(block.ref)} exists`,
    })),
  };
}

export { cliBlockNote, cliCommand, markupText };
