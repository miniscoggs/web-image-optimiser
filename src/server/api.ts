import { z } from "zod";
import { METRICS_VERDICTS } from "../metrics/types.js";
import { PIPELINE_TARGET_PRESETS } from "../pipeline/resolveSettings.js";
import { PIPELINE_MODES } from "../pipeline/types.js";
import type { PipelineTargetPreset } from "../pipeline/types.js";
import { ERROR_CODES } from "../schema/codes.js";
import { warningSchema } from "../schema/contract.js";

// the ui server's api, between the server and the ui it ships with; POST /api/optimise streams
// the contract's events, with paths as refs. the ui type-checks this file, so it imports no
// engine stages

const count = z.int().nonnegative();

/**
 * The formats the UI's quality sliders re-encode in: the lossy ones.
 */
const PIXEL_FORMATS = ["webp", "avif", "jpeg"] as const;

const PRESETS = Object.keys(PIPELINE_TARGET_PRESETS) as [
  PipelineTargetPreset,
  ...PipelineTargetPreset[],
];

/**
 * A file the API can read: `root/` then its path in the folder served, or `session/` then its
 * path in the server's temp folder, with `/` separators.
 */
const refSchema = z.string().min(1);

/**
 * An image the UI can pick.
 */
const listedFileSchema = z.object({
  ref: refSchema,
  bytes: count,
});

/**
 * `GET /api/files`: the folder served, its images (with those in subfolders, but not hidden
 * folders or `node_modules`), then the uploads.
 */
const filesResponseSchema = z.object({
  root: z.string().describe("The folder served, as an absolute path"),
  files: z.array(listedFileSchema),
});

/**
 * `POST /api/upload`, a multipart form with one or more `file` fields: the files as stored.
 */
const uploadResponseSchema = z.object({
  files: z.array(listedFileSchema),
});

/**
 * `POST /api/optimise`: the files to run, and the run's mode and target. The response is a
 * server-sent event stream of `PipelineEvent`s, then an `error` event if the run broke. In
 * `suite` mode each file carries the `markup` that `wio --to suite --markup` would print, run
 * in the folder served.
 */
const optimiseRequestSchema = z.object({
  files: z.array(refSchema).min(1),
  to: z.enum(PIPELINE_MODES).optional(),
  target: z.union([z.enum(PRESETS), z.number().min(0).max(100)]).optional(),
});

/**
 * `POST /api/encode`: re-encode a file at a quality.
 */
const encodeRequestSchema = z.object({
  file: refSchema,
  format: z.enum(PIXEL_FORMATS),
  quality: z.int().min(1).max(100),
});

/**
 * `POST /api/encode`'s response: the re-encoded file, its size, and its score against the file.
 */
const encodeResponseSchema = z.object({
  ref: refSchema,
  format: z.enum(PIXEL_FORMATS),
  quality: z.int(),
  bytes: count,
  saving: z.number().max(1),
  score: z.number().max(100),
  verdict: z.enum(METRICS_VERDICTS),
  warnings: z.array(warningSchema),
});

/**
 * `POST /api/diff`: draw where a candidate differs from its original.
 */
const diffRequestSchema = z.object({
  original: refSchema,
  candidate: refSchema,
});

/**
 * `POST /api/diff`'s response: the diff map, a PNG.
 */
const diffResponseSchema = z.object({
  ref: refSchema,
});

/**
 * `POST /api/write`: save a run's output or a re-encode into the folder served, beside its
 * original and named after it, as `wio` writes without `--out-dir`. An upload's goes in the
 * folder served itself. `inPlace` and `overwrite` are the CLI's flags.
 */
const writeRequestSchema = z.object({
  original: refSchema,
  candidate: refSchema,
  inPlace: z.boolean().optional(),
  overwrite: z.boolean().optional(),
});

/**
 * How a write went: `written`, `unchanged` when the image is the original as it was, or blocked
 * with nothing written because it would replace the original (`input`, which needs `inPlace`)
 * or another file (`exists`, which needs `overwrite`).
 */
const WRITE_OUTCOMES = ["written", "unchanged", "input", "exists"] as const;

/**
 * `POST /api/write`'s response: where the image goes, and how the write went.
 */
const writeResponseSchema = z.object({
  ref: refSchema,
  outcome: z.enum(WRITE_OUTCOMES),
});

/**
 * A failed request's body, with the optimiser's code when the image was the problem.
 */
const apiErrorSchema = z.object({
  error: z.string(),
  code: z.enum(ERROR_CODES).optional(),
});

/**
 * A format the UI's quality sliders re-encode in.
 */
type PixelFormat = (typeof PIXEL_FORMATS)[number];

/**
 * An image the UI can pick.
 */
type ServerListedFile = z.infer<typeof listedFileSchema>;

/**
 * `GET /api/files`'s response.
 */
type ServerFilesResponse = z.infer<typeof filesResponseSchema>;

/**
 * `POST /api/upload`'s response.
 */
type ServerUploadResponse = z.infer<typeof uploadResponseSchema>;

/**
 * `POST /api/encode`'s response.
 */
type ServerEncodeResponse = z.infer<typeof encodeResponseSchema>;

/**
 * `POST /api/diff`'s response.
 */
type ServerDiffResponse = z.infer<typeof diffResponseSchema>;

/**
 * `POST /api/write`'s response.
 */
type ServerWriteResponse = z.infer<typeof writeResponseSchema>;

export {
  PIXEL_FORMATS,
  apiErrorSchema,
  diffRequestSchema,
  diffResponseSchema,
  encodeRequestSchema,
  encodeResponseSchema,
  filesResponseSchema,
  optimiseRequestSchema,
  uploadResponseSchema,
  writeRequestSchema,
  writeResponseSchema,
};
export type {
  PixelFormat,
  ServerDiffResponse,
  ServerEncodeResponse,
  ServerFilesResponse,
  ServerListedFile,
  ServerUploadResponse,
  ServerWriteResponse,
};
