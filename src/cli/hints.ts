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
 * Adds the flag that fixes an error or warning to its message, since the library's messages
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

export default withHint;
export type { CliHints };
