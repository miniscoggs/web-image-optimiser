import type { z } from "zod";
import type {
  compareResultSchema,
  comparedImageSchema,
} from "../schema/contract.js";

/**
 * Options for {@link compareFiles}. Every option is optional.
 *
 * @example
 * ```ts
 * import type { CompareOptions } from "web-image-optimiser";
 *
 * const options: CompareOptions = { diff: "diff.png", overwrite: true };
 * ```
 */
type CompareOptions = {
  /** Where to write a PNG heat map of where the images differ. It must end in `.png`. */
  diff?: string;
  /** Lets the diff map replace an existing file. */
  overwrite?: boolean;
};

/**
 * One of the images {@link compareFiles} read: its path as given, and once read, its format,
 * size and displayed dimensions.
 *
 * @example
 * ```ts
 * import { compareFiles, type CompareImage } from "web-image-optimiser";
 *
 * const { original }: { original: CompareImage } = await compareFiles("a.png", "a.webp");
 * ```
 */
type CompareImage = z.infer<typeof comparedImageSchema>;

/**
 * The result of {@link compareFiles}, which `wio compare --json` prints: both images, the
 * candidate's SSIMULACRA 2 score and verdict, the size saving, the diff map's path, warnings,
 * and the error when the comparison failed. `docs/json-contract.md` describes each field.
 *
 * @example
 * ```ts
 * import { compareFiles, type CompareResult } from "web-image-optimiser";
 *
 * const result: CompareResult = await compareFiles("photo.png", "photo.webp");
 * ```
 */
type CompareResult = z.infer<typeof compareResultSchema>;

export type { CompareImage, CompareOptions, CompareResult };
