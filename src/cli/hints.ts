import type {
  OptimiserErrorCode,
  OptimiserWarningCode,
} from "../schema/index.js";

/**
 * The flag to suggest for each code, where a flag fixes it.
 */
type CliHints = Partial<
  Record<OptimiserErrorCode | OptimiserWarningCode, string>
>;

/**
 * The optimise command's hints, shared by its JSON and its table.
 */
const OPTIMISE_HINTS: CliHints = {
  E_OUTPUT_IS_INPUT: "--out-dir <dir> or --in-place",
  W_OUTPUT_EXISTS: "--overwrite",
  W_NO_RIGHTS:
    "--creator, --credit, --copyright, --rights-url, --licensor-url or --strip-all",
};

/**
 * Adds the flag that fixes an error or warning to its message, since the engine's messages
 * don't know the CLI's flags.
 *
 * @param item - The error or warning.
 * @param hints - The flag to suggest for each code.
 * @returns The item, with the hint in brackets after its message when there is one.
 */
function withHint<Item extends { code: keyof CliHints; message: string }>(
  item: Item,
  hints: CliHints
): Item {
  const hint = hints[item.code];

  return hint === undefined
    ? item
    : { ...item, message: `${item.message} (${hint})` };
}

export { OPTIMISE_HINTS, withHint };
export type { CliHints };
