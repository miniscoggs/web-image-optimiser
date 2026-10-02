import type { MetricsScorePool } from "../metrics/index.js";
import { isSourceRun } from "../runtime/index.js";
import { libuvThreads } from "./concurrency.js";
import failedResult from "./failedResult.js";
import optimiseFile from "./optimiseFile.js";
import type { PipelineFileResult, PipelineOptions } from "./types.js";
import createProcessSlot from "./processSlot.js";

/**
 * One file for an executor to optimise.
 */
type FileTask = {
  path: string;
  options: PipelineOptions;
};

/**
 * Optimises files one at a time for a batch lane.
 */
type FileExecutor = {
  /** Resolves with the file's result, or rejects with the signal's reason once aborted. */
  run: (task: FileTask, signal: AbortSignal) => Promise<PipelineFileResult>;
  /** Releases the executor once its last run has settled. */
  close: () => Promise<void>;
};

/**
 * A message to a batch lane's child process.
 */
type WorkerRequest = { type: "run"; task: FileTask } | { type: "abort" };

/**
 * A batch lane's child process's reply to a run.
 */
type WorkerReply =
  { type: "done"; result: PipelineFileResult } | { type: "aborted" };

/**
 * Optimises one file, turning an unexpected error into an `E_INTERNAL` result so one file can't
 * stop a batch.
 *
 * @param task - The file.
 * @param signal - Aborts the work.
 * @param scorePool - The threads to score on, if not the calling thread.
 * @returns The file's result; rejects only when aborted.
 */
async function runFile(
  task: FileTask,
  signal: AbortSignal,
  scorePool?: MetricsScorePool
): Promise<PipelineFileResult> {
  try {
    return await optimiseFile(task.path, task.options, { signal, scorePool });
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }

    const detail = error instanceof Error ? error.message : String(error);

    return failedResult(task.path, "E_INTERNAL", detail);
  }
}

/**
 * Creates an executor that runs files on the calling thread.
 */
function createInProcessExecutor(): FileExecutor {
  return { run: runFile, close: () => Promise.resolve() };
}

/**
 * Creates an executor that runs files in a child process of its own, so scoring, which blocks
 * its thread, runs in parallel with other lanes, and each lane has its own libuv pool for
 * sharp's work, sized for its scorers. A child that crashes, even natively, or can't start,
 * fails its file with `E_INTERNAL` and is replaced on the next run.
 *
 * @param moduleUrl - The child module, which takes `scorers` as its argument.
 * @param scorers - How many scores the child runs at once.
 */
function createProcessExecutor(moduleUrl: URL, scorers: number): FileExecutor {
  const slot = createProcessSlot(
    moduleUrl,
    [String(scorers)],
    libuvThreads(scorers)
  );

  return {
    run: async (task, signal) => {
      signal.throwIfAborted();

      const outcome = await slot.send<WorkerReply>(
        { type: "run", task } satisfies WorkerRequest,
        { signal, abort: { type: "abort" } satisfies WorkerRequest }
      );

      if (outcome.type === "crashed") {
        return failedResult(
          task.path,
          "E_INTERNAL",
          `The lane's process stopped: ${outcome.detail}`
        );
      }
      if (outcome.reply.type === "aborted") {
        throw signal.reason as Error;
      }
      return outcome.reply.result;
    },
    close: slot.close,
  };
}

/**
 * Creates an executor for a batch lane: a child process when running the build, or the
 * calling thread when running the TypeScript sources, whose `.js` imports a child can't load.
 *
 * @param scorers - How many scores the lane runs at once: a child scores more than one on a
 * pool of threads. The calling thread scores one at a time, since a thread can't load the
 * sources either.
 */
function createExecutor(scorers: number) {
  return isSourceRun(import.meta.url)
    ? createInProcessExecutor()
    : createProcessExecutor(new URL("./worker.js", import.meta.url), scorers);
}

export { createExecutor, runFile };
export type { FileExecutor, FileTask, WorkerReply, WorkerRequest };
