import { z } from "zod";
import { ENCODE_METHODS } from "../encode/types.js";
import { INSPECT_FORMATS } from "../inspect/types.js";
import { METRICS_VERDICTS } from "../metrics/types.js";
import { PIPELINE_MODES } from "../pipeline/types.js";
import { STRIP_REMOVED_KINDS } from "../strip/types.js";
import { ERROR_CODES, WARNING_CODES } from "./codes.js";
import SCHEMA_VERSION from "./version.js";

// the json contract: zod is only loaded by the build, the tests and the ui server, never at runtime

/**
 * Every output role.
 */
const OUTPUT_ROLES = ["same", "webp", "avif", "fallback"] as const;

/**
 * Every way an output can be made.
 */
const OUTPUT_METHODS = ["strip", "svgo", ...ENCODE_METHODS] as const;

/**
 * Every file status.
 */
const FILE_STATUSES = [
  "optimised",
  "kept-original",
  "skipped",
  "failed",
] as const;

const count = z.int().nonnegative();

/**
 * A warning about one file.
 */
const warningSchema = z
  .object({
    code: z.enum(WARNING_CODES),
    message: z
      .string()
      .describe(
        "For people; it may change between releases, so branch on code"
      ),
  })
  .meta({ id: "Warning" });

/**
 * One file written, or that would be in a dry run.
 */
const outputSchema = z
  .object({
    role: z
      .enum(OUTPUT_ROLES)
      .describe(
        "same when in the input's own format, else the format asked for, or fallback for a suite's JPEG or PNG"
      ),
    path: z.string(),
    format: z.enum(INSPECT_FORMATS),
    method: z
      .enum(OUTPUT_METHODS)
      .describe(
        "strip means the input with its metadata removed and its image data untouched"
      ),
    quality: z
      .int()
      .optional()
      .describe("The encoder quality, or near-lossless level"),
    bytes: count,
    gzipBytes: count
      .optional()
      .describe("For SVG, the size once gzipped, as a server usually sends it"),
    saving: z
      .number()
      .max(1)
      .describe("The fraction of the input's size saved"),
    score: z
      .number()
      .max(100)
      .describe("SSIMULACRA 2 against the input; 100 for identical pixels"),
    verdict: z.enum(METRICS_VERDICTS),
    strippedMetadata: z
      .array(z.enum(STRIP_REMOVED_KINDS))
      .describe("The kinds of metadata the input had that this output doesn't"),
  })
  .meta({ id: "Output" });

/**
 * Why something failed.
 */
const errorSchema = z
  .object({
    code: z.enum(ERROR_CODES),
    message: z
      .string()
      .describe(
        "For people; it may change between releases, so branch on code"
      ),
  })
  .meta({ id: "Error" });

/**
 * What happened to one file.
 */
const fileResultSchema = z
  .object({
    input: z.string().describe("The input path, as given"),
    status: z.enum(FILE_STATUSES),
    bytes: count.optional().describe("The input's size, once it has been read"),
    width: count
      .optional()
      .describe(
        "The image's displayed width in pixels, after orientation, once inspected; every output has the same size"
      ),
    height: count
      .optional()
      .describe("The image's displayed height in pixels, once inspected"),
    outputs: z
      .array(outputSchema)
      .describe("AVIF first and the fallback last; empty unless optimised"),
    warnings: z.array(warningSchema),
    error: errorSchema
      .optional()
      .describe("Why the file failed, when status is failed"),
    markup: z
      .string()
      .optional()
      .describe(
        "Only with the CLI's --markup: HTML that shows the image, a <picture> element or an <img>"
      ),
  })
  .meta({ id: "FileResult" });

/**
 * The versions that produced a run.
 */
const toolSchema = z
  .object({
    version: z.string().describe("web-image-optimiser's version"),
    sharp: z.string(),
    libvips: z.string(),
  })
  .meta({ id: "Tool" });

/**
 * The options a run used, with defaults filled in.
 */
const runOptionsSchema = z
  .object({
    to: z.enum(PIPELINE_MODES),
    target: z
      .number()
      .min(0)
      .max(100)
      .describe("The target score, with a preset resolved to its number"),
    outDir: z.string().optional(),
    inPlace: z.boolean(),
    overwrite: z.boolean(),
    dryRun: z.boolean(),
    concurrency: z.int().positive(),
  })
  .meta({ id: "RunOptions" });

/**
 * A run's totals.
 */
const totalsSchema = z
  .object({
    files: count,
    optimised: count,
    keptOriginal: count,
    skipped: count,
    failed: count,
    inputBytes: count.describe(
      "The total size of the optimised and kept-original inputs"
    ),
    outputBytes: count.describe(
      "The same files afterwards: each optimised file's smallest output, or the input kept"
    ),
    saving: z.number().max(1).describe("The fraction of inputBytes saved"),
  })
  .meta({ id: "Totals" });

/**
 * The result of a run, which `--json` prints.
 */
const runResultSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    tool: toolSchema,
    options: runOptionsSchema,
    files: z.array(fileResultSchema).describe("In input order"),
    totals: totalsSchema,
  })
  .meta({
    title: "RunResult",
    description: "The result of a web-image-optimiser run",
  });

/**
 * One progress event, which `--ndjson` prints a line for. A run emits `run-start`, then
 * `file-start` and `file-done` for each file (interleaved when files run in parallel), then
 * `run-done`.
 */
const eventSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("run-start"),
      schemaVersion: z.literal(SCHEMA_VERSION),
      tool: toolSchema,
      options: runOptionsSchema,
      files: count.describe("How many files the run has"),
    }),
    z.object({
      type: z.literal("file-start"),
      index: count.describe("The file's position in the run, from 0"),
      input: z.string(),
    }),
    z.object({
      type: z.literal("file-done"),
      index: count,
      file: fileResultSchema,
    }),
    z.object({
      type: z.literal("run-done"),
      totals: totalsSchema,
    }),
  ])
  .meta({
    title: "Event",
    description: "A progress event from a web-image-optimiser run",
  });

/**
 * One of the two images a comparison reads, with what is known about it once read.
 */
const comparedImageSchema = z
  .object({
    path: z.string().describe("The path, as given"),
    format: z.enum(INSPECT_FORMATS).optional(),
    bytes: count.optional(),
    width: count
      .optional()
      .describe("The displayed width in pixels, after orientation"),
    height: count.optional(),
  })
  .meta({ id: "ComparedImage" });

/**
 * The result of comparing two images, which `wio compare --json` prints.
 */
const compareResultSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    tool: toolSchema,
    original: comparedImageSchema,
    candidate: comparedImageSchema,
    score: z
      .number()
      .max(100)
      .optional()
      .describe(
        "SSIMULACRA 2 of the candidate against the original; 100 for identical pixels"
      ),
    verdict: z.enum(METRICS_VERDICTS).optional(),
    saving: z
      .number()
      .max(1)
      .optional()
      .describe(
        "The fraction of the original's size the candidate saves; negative when it is larger"
      ),
    diff: z
      .string()
      .optional()
      .describe("Where the diff map was written, when one was asked for"),
    warnings: z.array(warningSchema),
    error: errorSchema
      .optional()
      .describe("Why the comparison failed; score and verdict are then absent"),
  })
  .meta({
    title: "CompareResult",
    description: "The result of comparing two images with web-image-optimiser",
  });

export {
  FILE_STATUSES,
  OUTPUT_METHODS,
  OUTPUT_ROLES,
  compareResultSchema,
  comparedImageSchema,
  eventSchema,
  fileResultSchema,
  outputSchema,
  runResultSchema,
  warningSchema,
};
