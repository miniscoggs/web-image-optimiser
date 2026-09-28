import { isSourceRun } from "../runtime/index.js";
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
 * @returns The file's result; rejects only when aborted.
 */
async function runFile(
  task: FileTask,
  signal: AbortSignal
): Promise<PipelineFileResult> {
  try {
    return await optimiseFile(task.path, task.options, { signal });
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
 * sharp's work. A child that crashes, even natively, or can't start, fails its file with
 * `E_INTERNAL` and is replaced on the next run.
 *
 * @param moduleUrl - The child module.
 */
function createProcessExecutor(moduleUrl: URL): FileExecutor {
  const slot = createProcessSlot(moduleUrl);

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
 */
function createExecutor() {
  return isSourceRun(import.meta.url)
    ? createInProcessExecutor()
    : createProcessExecutor(new URL("./worker.js", import.meta.url));
}

export { createExecutor, runFile };
export type { FileExecutor, FileTask, WorkerReply, WorkerRequest };
