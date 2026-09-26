import { compareFiles } from "../compare/index.js";
import withHint from "./hints.js";
import type { CliHints } from "./hints.js";
import renderCompare from "./renderCompare.js";
import type { CliIo } from "./types.js";

const HINTS: CliHints = {
  W_OUTPUT_EXISTS: "--overwrite",
};

/**
 * The compare command's flags, as commander parses them.
 */
type CompareFlags = {
  diff?: string;
  overwrite?: boolean;
  json?: boolean;
};

/**
 * Runs the compare command: scores a candidate against its original, and prints the result
 * as text or one JSON `CompareResult`.
 *
 * @param original - The original image's path.
 * @param candidate - The candidate's path.
 * @param flags - The flags.
 * @param io - Where to write.
 * @returns The exit code: 1 when the comparison failed, otherwise 0.
 */
async function runCompare(
  original: string,
  candidate: string,
  flags: CompareFlags,
  io: CliIo
) {
  const compared = await compareFiles(
    original,
    candidate,
    { diff: flags.diff, overwrite: flags.overwrite },
    { signal: io.signal }
  );
  const result = {
    ...compared,
    warnings: compared.warnings.map((warning) => withHint(warning, HINTS)),
  };

  if (flags.json === true) {
    io.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (result.error === undefined) {
    io.stdout.write(renderCompare(result, io.color));
  } else {
    io.stderr.write(`wio: ${result.error.code} ${result.error.message}\n`);
  }
  return result.error === undefined ? 0 : 1;
}

export default runCompare;
export type { CompareFlags };
