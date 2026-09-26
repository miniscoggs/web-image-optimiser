import { availableParallelism, totalmem } from "node:os";
import { SCHEMA_VERSION } from "../schema/index.js";
import { createExecutor } from "./executors.js";
import type { FileTask } from "./executors.js";
import failedResult from "./failedResult.js";
import { resolveSettings } from "./resolveSettings.js";
import type { PipelineSettings } from "./resolveSettings.js";
import runTool from "./runTool.js";
import type {
  PipelineEvent,
  PipelineFileResult,
  PipelineOptions,
  PipelineRunResult,
} from "./types.js";

/**
 * Why a file fails before any work, such as an output that would clash with another file's.
 */
type BatchFailure = NonNullable<PipelineFileResult["error"]>;

/**
 * A batch's signal, event handler and concurrency, as {@link optimiseBatch} takes them.
 */
type BatchContext = {
  signal?: AbortSignal;
  onEvent?: (event: PipelineEvent) => void;
  concurrency?: number;
};

const WORKER_MEMORY = 4 * 1024 ** 3; // a worker's wasm scorer grows to 4 GiB on a 26 MP image

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
 * Runs files in lanes, as {@link optimiseBatch} describes, failing up front the files that
 * `findFailures` names. It is optimiseBatch's body, shared with the UI server, which decides
 * those failures its own way.
 *
 * @param tasks - The files, each with its options.
 * @param options - The run's options, which `run-start` reports.
 * @param context - The signal, the event handler and the concurrency.
 * @param findFailures - Finds the files that fail without running, by position, once the
 * options are known to be valid.
 * @throws RangeError when an option or the concurrency is invalid.
 */
async function runBatch(
  tasks: FileTask[],
  options: PipelineOptions,
  context: BatchContext,
  findFailures: (
    settings: PipelineSettings
  ) => Promise<ReadonlyMap<number, BatchFailure>>
): Promise<PipelineRunResult> {
  const settings = resolveSettings(options);
  const concurrency = context.concurrency ?? defaultConcurrency();

  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError(
      `Expected a concurrency of at least 1, got ${concurrency}`
    );
  }
  context.signal?.throwIfAborted();

  const failures = await findFailures(settings);

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
        const failure = failures.get(index);

        if (task === undefined) {
          break;
        }
        emit({ type: "file-start", index, input: task.path });

        const file =
          failure === undefined
            ? await executor.run(task, controller.signal)
            : failedResult(task.path, failure.code, failure.message);

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

export default runBatch;
export type { BatchContext, BatchFailure };
