import { Worker } from "node:worker_threads";
import failedResult from "./failedResult.js";
import optimiseFile from "./optimiseFile.js";
import type { PipelineFileResult, PipelineOptions } from "./types.js";

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
 * A message to a batch worker.
 */
type WorkerRequest = { type: "run"; task: FileTask } | { type: "abort" };

/**
 * A batch worker's reply to a run.
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
 * Creates an executor that runs files on a worker thread of its own, so scoring, which blocks
 * its thread, runs in parallel with other lanes. A worker that crashes fails its file with
 * `E_INTERNAL` and is replaced on the next run.
 *
 * @param workerUrl - The worker module.
 */
function createWorkerExecutor(workerUrl: URL): FileExecutor {
  let worker: Worker | undefined;

  const run = (task: FileTask, signal: AbortSignal) => {
    if (signal.aborted) {
      return Promise.reject(signal.reason as Error);
    }

    const current = (worker ??= new Worker(workerUrl));

    return new Promise<PipelineFileResult>((resolve, reject) => {
      const abort = () => {
        current.postMessage({ type: "abort" } satisfies WorkerRequest);
      };
      const settle = () => {
        signal.removeEventListener("abort", abort);
        current.off("message", onMessage);
        current.off("error", onCrash);
        current.off("exit", onCrash);
      };
      const onMessage = (reply: WorkerReply) => {
        settle();
        if (reply.type === "aborted") {
          reject(signal.reason as Error);
        } else {
          resolve(reply.result);
        }
      };
      const onCrash = (cause: Error | number) => {
        const detail =
          cause instanceof Error ? cause.message : `exit code ${cause}`;

        settle();
        worker = undefined;
        void current.terminate();
        resolve(
          failedResult(task.path, "E_INTERNAL", `The worker stopped: ${detail}`)
        );
      };

      signal.addEventListener("abort", abort, { once: true });
      current.on("message", onMessage);
      current.once("error", onCrash);
      current.once("exit", onCrash);
      current.postMessage({ type: "run", task } satisfies WorkerRequest);
    });
  };

  return {
    run,
    close: async () => {
      await worker?.terminate();
    },
  };
}

/**
 * Creates an executor for a batch lane: a worker thread when running the built package, or the
 * calling thread when running the TypeScript sources, whose `.js` imports a worker can't load.
 */
function createExecutor() {
  const fromSource = new URL(import.meta.url).pathname.endsWith(".ts");

  return fromSource
    ? createInProcessExecutor()
    : createWorkerExecutor(new URL("./worker.js", import.meta.url));
}

export { createExecutor, runFile };
export type { FileExecutor, FileTask, WorkerReply, WorkerRequest };
