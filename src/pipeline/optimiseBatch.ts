import { open } from "node:fs/promises";
import { availableParallelism, totalmem } from "node:os";
import { detectFormat } from "../inspect/detectFormat.js";
import { SCHEMA_VERSION } from "../schema/index.js";
import { comparablePath, outputClaims } from "./destination.js";
import { createExecutor } from "./executors.js";
import type { FileTask } from "./executors.js";
import failedResult from "./failedResult.js";
import { resolveSettings } from "./resolveSettings.js";
import runTool from "./runTool.js";
import type {
  PipelineBatchInput,
  PipelineEvent,
  PipelineFileResult,
  PipelineMode,
  PipelineOptions,
  PipelineRunResult,
} from "./types.js";

const WORKER_MEMORY = 4 * 1024 ** 3; // a worker's wasm scorer grows to 4 GiB on a 26 MP image
const SNIFF_BYTES = 16 * 1024; // any format's signature, and an svg's prolog up to its root

/**
 * Returns how many files to optimise at once by default: one fewer than the CPUs, and no more
 * than the memory holds at a worker's worst case.
 */
function defaultConcurrency() {
  const byCpu = availableParallelism() - 1;
  const byMemory = Math.floor(totalmem() / WORKER_MEMORY);

  return Math.max(1, Math.min(byCpu, byMemory));
}

/**
 * Reads enough of a file to detect its format from its bytes.
 *
 * @param filePath - The file.
 * @returns The format, or `undefined` when it can't be read or isn't supported, which the file
 * reports when its turn comes.
 */
async function sniffFormat(filePath: string) {
  try {
    const handle = await open(filePath);

    try {
      const { buffer, bytesRead } = await handle.read(
        Buffer.alloc(SNIFF_BYTES),
        0,
        SNIFF_BYTES,
        0
      );

      return detectFormat(buffer.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

/**
 * Finds the inputs that can't run without clashing, each mapped to why: an output that could
 * land on another input, or on a path an earlier input's outputs could use. Formats come from
 * the files' bytes, so a misnamed file is caught too.
 *
 * @param tasks - The files, in order.
 * @param mode - The mode.
 */
async function findConflicts(tasks: FileTask[], mode: PipelineMode) {
  const inputs = new Map<string, number>(); // each input's first position
  const claims = new Map<string, string>();
  const conflicts = new Map<number, string>();

  for (const [index, task] of tasks.entries()) {
    const key = comparablePath(task.path);

    if (!inputs.has(key)) {
      inputs.set(key, index);
    }
  }
  for (const [index, task] of tasks.entries()) {
    const format = await sniffFormat(task.path); // one at a time, so a huge batch can't run out of file handles
    const paths =
      format === undefined
        ? []
        : outputClaims(task.path, format, task.options.outDir, mode);
    const ownKey = comparablePath(task.path);
    const firstIndex = inputs.get(ownKey) ?? index;
    let reason =
      firstIndex === index
        ? undefined
        : `It is the same file as an earlier input, ${tasks[firstIndex]?.path}`;

    for (const claim of paths) {
      const inputIndex = inputs.get(claim);
      const claimant = claims.get(claim);

      if (claimant !== undefined) {
        reason ??= `Its outputs would land on those of ${claimant}`;
      } else if (inputIndex !== undefined && claim !== ownKey) {
        reason ??= `One of its outputs would replace another input, ${tasks[inputIndex]?.path}`;
      }
    }
    if (reason === undefined) {
      for (const claim of paths) {
        claims.set(claim, task.path);
      }
    } else {
      conflicts.set(index, reason);
    }
  }
  return conflicts;
}

/**
 * Adds up a run's files: how many ended each way, and the bytes of the optimised and
 * kept-original inputs before and after, counting an optimised file's smallest output.
 *
 * @param files - Every file's result.
 */
function totalsOf(files: PipelineFileResult[]): PipelineRunResult["totals"] {
  const count = (status: PipelineFileResult["status"]) =>
    files.filter((file) => file.status === status).length;
  let inputBytes = 0;
  let outputBytes = 0;

  for (const file of files) {
    if (file.status === "optimised" || file.status === "kept-original") {
      const sizes = file.outputs.map((output) => output.bytes);

      inputBytes += file.bytes ?? 0;
      outputBytes += Math.min(file.bytes ?? 0, ...sizes);
    }
  }

  return {
    files: files.length,
    optimised: count("optimised"),
    keptOriginal: count("kept-original"),
    skipped: count("skipped"),
    failed: count("failed"),
    inputBytes,
    outputBytes,
    saving: inputBytes === 0 ? 0 : 1 - outputBytes / inputBytes,
  };
}

/**
 * Optimises many image files with {@link optimiseFile}'s rules, several at once, each on a worker
 * thread of its own.
 *
 * Before any work, an input fails with `E_OUTPUT_CONFLICT` when one of its outputs could land on
 * another input, or on an earlier input's outputs (such as `photo.png` and `photo.jpg` both
 * writing `photo.webp`), judging formats from the files' bytes. An
 * unexpected error in one file fails it with `E_INTERNAL` rather than stopping the run. Events
 * report progress: `run-start`, then `file-start` and `file-done` for each file, then `run-done`.
 *
 * @param inputs - The image paths, each optionally with its own output folder.
 * @param options - What to write, and where, as for {@link optimiseFile}.
 * @param context - `signal` aborts the run: it rejects with the signal's reason once every file
 * in progress has stopped and cleaned up its temp files. `onEvent` receives each event.
 * `concurrency` is how many files run at once; it defaults to one fewer than the CPUs, capped at
 * one per 4 GiB of memory, because scoring a very large image takes that much.
 * @returns Every file's result in input order, with totals and the versions used.
 * @throws RangeError when an option or the concurrency is invalid.
 *
 * @example
 * ```ts
 * import { optimiseBatch } from "web-image-optimiser";
 *
 * const result = await optimiseBatch(["hero.jpg", "logo.png"], { to: "suite", outDir: "web" }, {
 *   onEvent: (event) => {
 *     if (event.type === "file-done") console.log(event.file.input, event.file.status);
 *   },
 * });
 * console.log(result.totals);
 * ```
 */
async function optimiseBatch(
  inputs: PipelineBatchInput[],
  options: PipelineOptions = {},
  context: {
    signal?: AbortSignal;
    onEvent?: (event: PipelineEvent) => void;
    concurrency?: number;
  } = {}
): Promise<PipelineRunResult> {
  const settings = resolveSettings(options);
  const concurrency = context.concurrency ?? defaultConcurrency();

  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError(
      `Expected a concurrency of at least 1, got ${concurrency}`
    );
  }
  context.signal?.throwIfAborted();

  const tasks = inputs.map((input) =>
    typeof input === "string"
      ? { path: input, options }
      : {
          path: input.path,
          options: { ...options, outDir: input.outDir ?? options.outDir },
        }
  );
  const conflicts = await findConflicts(tasks, settings.to);

  context.signal?.throwIfAborted(); // the abort listener below isn't attached yet
  const emit = context.onEvent ?? (() => undefined);
  const controller = new AbortController(); // also stops the other lanes when one fails
  const stop = () => {
    controller.abort(context.signal?.reason);
  };
  const tool = runTool();
  const runOptions = { ...settings, concurrency };
  const files: PipelineFileResult[] = [];
  let next = 0;

  const lane = async () => {
    const executor = createExecutor();

    try {
      for (
        let index = next++;
        index < tasks.length && !controller.signal.aborted;
        index = next++
      ) {
        const task = tasks[index];
        const conflict = conflicts.get(index);

        if (task === undefined) {
          break;
        }
        emit({ type: "file-start", index, input: task.path });

        const file =
          conflict === undefined
            ? await executor.run(task, controller.signal)
            : failedResult(task.path, "E_OUTPUT_CONFLICT", conflict);

        files[index] = file;
        emit({ type: "file-done", index, file });
      }
    } catch (error) {
      controller.abort(error);
      throw error;
    } finally {
      await executor.close();
    }
  };

  context.signal?.addEventListener("abort", stop, { once: true });
  try {
    emit({
      type: "run-start",
      schemaVersion: SCHEMA_VERSION,
      tool,
      options: runOptions,
      files: tasks.length,
    });

    const lanes = Array.from(
      { length: Math.min(concurrency, tasks.length) },
      lane
    );
    const settled = await Promise.allSettled(lanes);
    const failure = settled.find((outcome) => outcome.status === "rejected");

    if (failure !== undefined) {
      throw failure.reason;
    }
    context.signal?.throwIfAborted();
  } finally {
    context.signal?.removeEventListener("abort", stop);
  }

  const totals = totalsOf(files);

  emit({ type: "run-done", totals });
  return {
    schemaVersion: SCHEMA_VERSION,
    tool,
    options: runOptions,
    files,
    totals,
  };
}

export default optimiseBatch;
