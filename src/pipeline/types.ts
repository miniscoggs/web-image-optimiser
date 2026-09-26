import type { z } from "zod";
import type {
  FILE_STATUSES,
  OUTPUT_METHODS,
  OUTPUT_ROLES,
  eventSchema,
  fileResultSchema,
  outputSchema,
  runResultSchema,
  warningSchema,
} from "../schema/contract.js";

/**
 * Every {@link PipelineMode}, for validating input.
 *
 * @example
 * ```ts
 * import { PIPELINE_MODES } from "../pipeline/index.js";
 *
 * PIPELINE_MODES.includes("suite"); // true
 * ```
 */
const PIPELINE_MODES = ["same", "webp", "avif", "suite"] as const;

/**
 * What {@link optimiseFile} writes:
 *
 * - `same`: the source's own format, re-encoded or with its metadata stripped, whichever is
 *   smallest.
 * - `webp` and `avif`: that format.
 * - `suite`: AVIF, WebP and a JPEG or PNG fallback for a `<picture>` element, keeping each only
 *   when it's smaller than the next.
 *
 * @example
 * ```ts
 * import type { PipelineMode } from "web-image-optimiser";
 *
 * const mode: PipelineMode = "suite";
 * ```
 */
type PipelineMode = (typeof PIPELINE_MODES)[number];

/**
 * A named quality target: `visually-lossless` (SSIMULACRA 2 score 90), `excellent` (85),
 * `high` (80) or `web` (70).
 *
 * @example
 * ```ts
 * import type { PipelineTargetPreset } from "web-image-optimiser";
 *
 * const target: PipelineTargetPreset = "excellent";
 * ```
 */
type PipelineTargetPreset = "visually-lossless" | "excellent" | "high" | "web";

/**
 * Options for {@link optimiseFile}. Every option is optional.
 *
 * @example
 * ```ts
 * import type { PipelineOptions } from "web-image-optimiser";
 *
 * const options: PipelineOptions = { to: "avif", target: "excellent", outDir: "web" };
 * ```
 */
type PipelineOptions = {
  /** What to write. Defaults to `webp`. */
  to?: PipelineMode;
  /** The lowest SSIMULACRA 2 score an output may have, as a preset or a number from 0 to 100. Defaults to `high` (80). SVGs always use 90. */
  target?: PipelineTargetPreset | number;
  /** The folder to write into. Defaults to the input's own folder. */
  outDir?: string;
  /** Lets an output replace its own input. */
  inPlace?: boolean;
  /** Lets an output replace an existing file other than the input. */
  overwrite?: boolean;
  /** Works everything out and reports it, but writes nothing. */
  dryRun?: boolean;
};

/**
 * What an output is for: `same` when it's in the source's own format (always, for SVG),
 * otherwise the format it was asked for, or `fallback` for a suite's JPEG or PNG.
 *
 * @example
 * ```ts
 * import type { PipelineOutputRole } from "web-image-optimiser";
 *
 * const role: PipelineOutputRole = "fallback";
 * ```
 */
type PipelineOutputRole = (typeof OUTPUT_ROLES)[number];

/**
 * How an output was made: `strip` (the source with its metadata removed and its image data
 * untouched), `svgo`, or an encoder's `lossy`, `lossless` or `near-lossless` mode.
 *
 * @example
 * ```ts
 * import type { PipelineOutputMethod } from "web-image-optimiser";
 *
 * const method: PipelineOutputMethod = "strip";
 * ```
 */
type PipelineOutputMethod = (typeof OUTPUT_METHODS)[number];

/**
 * One file {@link optimiseFile} wrote, or would write in a dry run: its role, path, format,
 * method, quality, size (and gzipped size for SVG), saving, score, verdict and the metadata it
 * dropped. `docs/json-contract.md` describes each field.
 *
 * @example
 * ```ts
 * import { optimiseFile, type PipelineOutput } from "web-image-optimiser";
 *
 * const [output]: PipelineOutput[] = (await optimiseFile("photo.jpg")).outputs;
 * ```
 */
type PipelineOutput = z.infer<typeof outputSchema>;

/**
 * A warning about one file, with a stable code and a plain-language message.
 *
 * @example
 * ```ts
 * import type { PipelineWarning } from "web-image-optimiser";
 *
 * const warning: PipelineWarning = { code: "W_ICC_KEPT", message: "..." };
 * ```
 */
type PipelineWarning = z.infer<typeof warningSchema>;

/**
 * How a file ended:
 *
 * - `optimised`: at least one output was written (or would be, in a dry run).
 * - `kept-original`: nothing was smaller and there was no metadata to strip, so nothing was
 *   written.
 * - `skipped`: an output already exists (`W_OUTPUT_EXISTS`).
 * - `failed`: see `error`.
 *
 * @example
 * ```ts
 * import type { PipelineFileStatus } from "web-image-optimiser";
 *
 * const status: PipelineFileStatus = "kept-original";
 * ```
 */
type PipelineFileStatus = (typeof FILE_STATUSES)[number];

/**
 * The result of {@link optimiseFile}: the input path as given, its status and size, what was
 * written (AVIF first, the fallback last), warnings, and the error when it failed.
 *
 * @example
 * ```ts
 * import { optimiseFile, type PipelineFileResult } from "web-image-optimiser";
 *
 * const result: PipelineFileResult = await optimiseFile("photo.jpg", { outDir: "web" });
 * ```
 */
type PipelineFileResult = z.infer<typeof fileResultSchema>;

/**
 * The result of {@link optimiseBatch}, which `--json` prints: the contract's
 * `schemaVersion`, the tool's versions, the options used, every file's result in input order,
 * and totals.
 *
 * @example
 * ```ts
 * import { optimiseBatch, type PipelineRunResult } from "web-image-optimiser";
 *
 * const result: PipelineRunResult = await optimiseBatch(["a.jpg", "b.png"], { outDir: "web" });
 * ```
 */
type PipelineRunResult = z.infer<typeof runResultSchema>;

/**
 * A progress event from {@link optimiseBatch}, which `--ndjson` prints a line for:
 * `run-start`, then `file-start` and `file-done` for each file (interleaved when files run
 * in parallel), then `run-done` with the totals.
 *
 * @example
 * ```ts
 * import { optimiseBatch, type PipelineEvent } from "web-image-optimiser";
 *
 * const onEvent = (event: PipelineEvent) => {
 *   if (event.type === "file-done") console.log(event.file.input, event.file.status);
 * };
 * await optimiseBatch(["a.jpg"], {}, { onEvent });
 * ```
 */
type PipelineEvent = z.infer<typeof eventSchema>;

/**
 * An input to {@link optimiseBatch}: a path, or a path with its own output folder, which
 * overrides `outDir`.
 *
 * @example
 * ```ts
 * import type { PipelineBatchInput } from "web-image-optimiser";
 *
 * const inputs: PipelineBatchInput[] = ["logo.png", { path: "blog/hero.jpg", outDir: "web/blog" }];
 * ```
 */
type PipelineBatchInput = string | { path: string; outDir?: string };

export { PIPELINE_MODES };
export type {
  PipelineBatchInput,
  PipelineEvent,
  PipelineFileResult,
  PipelineFileStatus,
  PipelineMode,
  PipelineOptions,
  PipelineOutput,
  PipelineOutputMethod,
  PipelineOutputRole,
  PipelineRunResult,
  PipelineTargetPreset,
  PipelineWarning,
};
