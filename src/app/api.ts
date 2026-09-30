import { z } from "zod";
import { METRICS_VERDICTS } from "../metrics/types.js";
import {
  PIPELINE_RIGHTS_OPTIONS,
  PIPELINE_TARGET_PRESETS,
} from "../pipeline/resolveSettings.js";
import type {
  PipelineRightsOptions,
  PipelineTargetPreset,
} from "../pipeline/types.js";
import { IMAGE_RIGHTS_FIELDS } from "../rights/types.js";
import { ERROR_CODES } from "../schema/codes.js";
import {
  OUTPUT_METHODS,
  rightsSchema,
  warningSchema,
} from "../schema/contract.js";

// the app api, between the desktop app's main process and its page; POST /api/optimise streams
// the contract's events, with paths as refs. the ui type-checks this file, so it imports no
// engine stages

const count = z.int().nonnegative();
const saving = z.number().max(1); // negative when larger than the original

/**
 * The formats the target sliders search in: every raster format a suite writes.
 */
const PIXEL_FORMATS = ["webp", "avif", "jpeg", "png"] as const;

const PRESETS = Object.keys(PIPELINE_TARGET_PRESETS) as [
  PipelineTargetPreset,
  ...PipelineTargetPreset[],
];

/**
 * A file the API can read: `file/<n>/<name>`, a file the desktop app opened, or `session/` then
 * its path in the API's temp folder, with `/` separators.
 */
const refSchema = z.string().min(1);

/**
 * What happens to the rights fields, as the CLI's `--strip-all` and rights flags.
 */
const metadataShape = {
  stripAll: z.boolean().optional(),
  rights: z
    .partialRecord(z.enum(PIPELINE_RIGHTS_OPTIONS), z.string())
    .optional(),
};

/**
 * The options a run and a search share, as the CLI's `--target` and `--max-width`.
 */
const settingsShape = {
  target: z.union([z.enum(PRESETS), z.number().min(0).max(100)]),
  maxWidth: z.int().min(1).optional(),
  ...metadataShape,
};

/**
 * What `open` gives for each path: an opened image's ref, name and size in bytes, or why it
 * wasn't opened.
 */
const openedFileSchema = z.union([
  z.object({ ref: refSchema, name: z.string(), bytes: count }),
  z.object({ name: z.string(), error: z.string() }),
]);

/**
 * `POST /api/optimise`: the opened files to run in `suite` mode, and the run's options. The
 * response is a server-sent event stream of `PipelineEvent`s, then an `error` event if the run
 * broke.
 */
const optimiseRequestSchema = z.object({
  files: z.array(refSchema).min(1),
  ...settingsShape,
});

/**
 * `POST /api/search`: find a file's smallest output in a format that reaches a target.
 */
const searchRequestSchema = z.object({
  file: refSchema,
  format: z.enum(PIXEL_FORMATS),
  ...settingsShape,
});

/**
 * `POST /api/search`'s response: the output a suite would choose in the format, apart from the
 * chain rule, with its size and score against the file. When nothing reaches the target under
 * the file's size, it is the best carrying every rights field, which may fall short (`reached`
 * is false) or be larger (`saving` is negative).
 */
const searchResponseSchema = z.object({
  ref: refSchema,
  format: z.enum(PIXEL_FORMATS),
  method: z.enum(OUTPUT_METHODS),
  quality: z.int().optional(),
  bytes: count,
  saving,
  score: z.number().max(100),
  verdict: z.enum(METRICS_VERDICTS),
  reached: z.boolean(),
  warnings: z.array(warningSchema),
});

/**
 * `POST /api/diff`: draw where a candidate differs from its original, shrunk first to the
 * maximum width the candidate was made at.
 */
const diffRequestSchema = z.object({
  original: refSchema,
  candidate: refSchema,
  maxWidth: z.int().min(1).optional(),
});

/**
 * `POST /api/diff`'s response: the diff map, a PNG.
 */
const diffResponseSchema = z.object({
  ref: refSchema,
});

/**
 * `POST /api/rights`: write the rights fields into outputs again, from their originals' own
 * fields and the ones given, without re-encoding them.
 */
const rightsRequestSchema = z.object({
  candidates: z
    .array(z.object({ original: refSchema, candidate: refSchema }))
    .min(1),
  ...metadataShape,
});

/**
 * `POST /api/rights`'s response: each output as rewritten, in the request's order. `larger` is
 * true when the fields make it larger than its original, which can't then be saved.
 */
const rightsResponseSchema = z.object({
  candidates: z.array(
    z.object({
      ref: refSchema,
      bytes: count,
      saving,
      larger: z.boolean(),
      rights: rightsSchema,
      rightsAdded: z.array(z.enum(IMAGE_RIGHTS_FIELDS)),
      warnings: z.array(warningSchema),
    })
  ),
});

/**
 * `saveOutput`'s refs: an opened file, and an output of it from a run, a search or
 * `/api/rights`.
 */
const saveOutputRequestSchema = z.object({
  original: refSchema,
  candidate: refSchema,
});

/**
 * `saveOutput`'s result: the file's name, whether it was written (not when it already held the
 * same bytes), and whether it replaced the original.
 */
const savedOutputSchema = z.object({
  name: z.string(),
  written: z.boolean(),
  replacedOriginal: z.boolean(),
});

/**
 * `saveSuites`' refs: each opened file with the outputs to save.
 */
const saveSuitesRequestSchema = z
  .array(z.object({ original: refSchema, candidates: z.array(refSchema) }))
  .min(1);

/**
 * `saveSuites`' result, one per output saved: its name, and the name it would have had if that
 * weren't taken.
 */
const savedSuiteFileSchema = z.object({
  original: refSchema,
  candidate: refSchema,
  name: z.string(),
  wanted: z.string(),
});

/**
 * A failed request's body, with the optimiser's code when the image was the problem.
 */
const apiErrorSchema = z.object({
  error: z.string(),
  code: z.enum(ERROR_CODES).optional(),
});

/**
 * A failed request's body, and what the main process's calls give the page for a failure.
 */
type AppApiError = z.infer<typeof apiErrorSchema>;

/**
 * The desktop app's options bar, which it remembers between launches: a run's maximum width,
 * and what happens to the rights fields, as the CLI's `--max-width`, `--strip-all` and rights
 * flags. The rights fields stay while `stripAll` is on, so they're back when it's turned off.
 */
type AppOptions = {
  maxWidth?: number;
  stripAll: boolean;
  rights: PipelineRightsOptions;
};

/**
 * A format the target sliders search in.
 */
type PixelFormat = (typeof PIXEL_FORMATS)[number];

/**
 * What `open` gives for one path.
 */
type AppOpenedFile = z.infer<typeof openedFileSchema>;

/**
 * `POST /api/search`'s response.
 */
type AppSearchResponse = z.infer<typeof searchResponseSchema>;

/**
 * `POST /api/diff`'s response.
 */
type AppDiffResponse = z.infer<typeof diffResponseSchema>;

/**
 * `POST /api/rights`' response.
 */
type AppRightsResponse = z.infer<typeof rightsResponseSchema>;

/**
 * `saveOutput`'s refs.
 */
type AppSaveOutputRefs = z.infer<typeof saveOutputRequestSchema>;

/**
 * `saveOutput`'s result.
 */
type AppSavedOutput = z.infer<typeof savedOutputSchema>;

/**
 * `saveSuites`' refs.
 */
type AppSaveSuites = z.infer<typeof saveSuitesRequestSchema>;

/**
 * One output `saveSuites` saved.
 */
type AppSavedSuiteFile = z.infer<typeof savedSuiteFileSchema>;

export {
  PIXEL_FORMATS,
  apiErrorSchema,
  diffRequestSchema,
  diffResponseSchema,
  openedFileSchema,
  optimiseRequestSchema,
  rightsRequestSchema,
  rightsResponseSchema,
  saveOutputRequestSchema,
  saveSuitesRequestSchema,
  savedOutputSchema,
  savedSuiteFileSchema,
  searchRequestSchema,
  searchResponseSchema,
};
export type {
  AppApiError,
  AppDiffResponse,
  AppOpenedFile,
  AppOptions,
  AppRightsResponse,
  AppSaveOutputRefs,
  AppSaveSuites,
  AppSavedOutput,
  AppSavedSuiteFile,
  AppSearchResponse,
  PixelFormat,
};
