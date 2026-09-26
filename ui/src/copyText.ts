import type { PipelineFileResult } from "../../src/pipeline/types.js";
import type { RunOptions } from "./api.js";
import { displayName } from "./refs.js";

const PLAIN_ARGUMENT = /^[\w./+-]+$/; // needs no quotes in any shell

const POWERSHELL_QUOTES = /['‘’‚‛]/g; // powershell ends a single-quoted string at any of these

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

export { cliCommand, markupText };
